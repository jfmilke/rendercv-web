FROM node:24-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
RUN groupadd --gid 999 backend && useradd --uid 999 --gid backend --create-home backend
WORKDIR /app

COPY shared /shared
RUN pip install --no-cache-dir /shared

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/backend_app ./backend_app
COPY --from=frontend-build /frontend/dist ./static

USER backend
EXPOSE 8000
CMD ["uvicorn", "backend_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
