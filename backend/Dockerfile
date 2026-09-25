FROM node:24-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
RUN groupadd --gid 999 app && useradd --uid 999 --gid app --create-home app
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/backend_app ./backend_app
COPY --from=frontend-build /frontend/dist ./static

# Set HOME explicitly rather than relying on it being derived from /etc/passwd:
# the Typst package cache below is keyed off $HOME, and it must resolve to the
# same path at runtime even if compose overrides `user:`.
ENV HOME=/home/app
USER app

# The container runs with dropped capabilities and a read-only root
# filesystem for security isolation around the code that runs rendercv/Typst
# on untrusted input; it has no reason to reach the network at render time,
# even though (unlike the old network-isolated worker container) nothing
# actually blocks egress at the network layer. rendercv's bundled Typst
# library unconditionally imports the
# third-party "@preview/fontawesome:0.6.0" Typst package for icon rendering on
# every render, which Typst otherwise tries to download on first use.
# Pre-warm Typst's package cache here at build time (when network access is
# still available) so the exact same cache path Typst resolves at runtime
# ($HOME/.cache/typst/packages, i.e. /home/app/.cache/typst/packages) is
# already populated in the image layer, and no network call is ever needed at
# render time.
RUN printf '#import "@preview/fontawesome:0.6.0": fa-icon\n' > /home/app/_warm.typ \
    && python3 -c "import typst; typst.compile('/home/app/_warm.typ', output='/home/app/_warm.pdf')" \
    && rm -f /home/app/_warm.typ /home/app/_warm.pdf

EXPOSE 8000
CMD ["uvicorn", "backend_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
