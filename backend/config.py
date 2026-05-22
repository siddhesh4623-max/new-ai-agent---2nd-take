import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("BINANCE_API_KEY")
SECRET_KEY = os.getenv("BINANCE_SECRET_KEY")
BASE_URL = "https://testnet.binancefuture.com"

assert API_KEY, "API_KEY missing"
assert SECRET_KEY, "SECRET_KEY missing"
assert BASE_URL, "BASE_URL missing"
