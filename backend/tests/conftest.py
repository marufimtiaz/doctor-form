import os

# Must be set before app.core.config is imported, since Settings is cached.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("S3_BOOTSTRAP", "false")
