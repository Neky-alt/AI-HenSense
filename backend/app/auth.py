"""Verify each authenticated request with the configured Supabase Auth server."""
from uuid import UUID
import httpx
from fastapi import Header, HTTPException
from app.config import settings

def current_user(authorization: str | None=Header(default=None)) -> str:
    if not authorization or not authorization.startswith('Bearer ') or not authorization[7:].strip():
        raise HTTPException(401,'Sign in to continue')
    url=settings.SUPABASE_URL.rstrip('/')
    key=settings.SUPABASE_PUBLISHABLE_KEY
    if not url.startswith('https://') or not key:raise HTTPException(503,'Authentication is not configured')
    try:
        response=httpx.get(f'{url}/auth/v1/user',headers={'Authorization':authorization,'apikey':key},timeout=10)
    except httpx.HTTPError as exc:raise HTTPException(503,'Unable to verify session. Try again.') from exc
    if response.status_code in (401,403):raise HTTPException(401,'Session expired. Sign in again.')
    if response.status_code!=200:raise HTTPException(503,'Unable to verify session. Try again.')
    try:return str(UUID(response.json()['id']))
    except (ValueError,KeyError,TypeError) as exc:raise HTTPException(401,'Invalid session') from exc
