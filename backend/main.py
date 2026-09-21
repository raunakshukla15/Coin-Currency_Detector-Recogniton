from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth import router as auth_router
from contact import router as contact_router
from config import CORS_ORIGINS

app = FastAPI(title="CoinScan API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(contact_router)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "coinscan", "version": "1.0.0"}