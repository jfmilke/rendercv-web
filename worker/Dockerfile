FROM python:3.12-slim-bookworm

RUN groupadd --gid 999 worker && useradd --uid 999 --gid worker --create-home worker

WORKDIR /app

COPY shared /shared
RUN pip install --no-cache-dir /shared

COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker/worker_app ./worker_app

USER worker

EXPOSE 8000
CMD ["uvicorn", "worker_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
