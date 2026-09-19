FROM python:3.12-slim-bookworm

RUN groupadd --gid 999 worker && useradd --uid 999 --gid worker --create-home worker

WORKDIR /app

COPY shared /shared
RUN pip install --no-cache-dir /shared

COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker/worker_app ./worker_app

USER worker

# The worker container runs with no internet route at runtime (internal-only
# Docker network, see docker-compose.yml) for security isolation. rendercv's
# bundled Typst library unconditionally imports the third-party
# "@preview/fontawesome:0.6.0" Typst package for icon rendering on every
# render, which Typst otherwise tries to download on first use. Pre-warm
# Typst's package cache here at build time (when network access is still
# available) so the exact same cache path Typst resolves at runtime
# ($HOME/.cache/typst/packages, i.e. /home/worker/.cache/typst/packages) is
# already populated in the image layer, and no network call is ever needed
# at render time.
RUN printf '#import "@preview/fontawesome:0.6.0": fa-icon\n' > /home/worker/_warm.typ \
    && python3 -c "import typst; typst.compile('/home/worker/_warm.typ', output='/home/worker/_warm.pdf')" \
    && rm -f /home/worker/_warm.typ /home/worker/_warm.pdf

EXPOSE 8000
CMD ["uvicorn", "worker_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
