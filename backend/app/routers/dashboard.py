"""BE-02 Home dashboard aggregation endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.farm_access import authorized_db
from app.responses import success
from app.services.core_data import dashboard_summary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", summary="Get Cage and Free-range dashboard summary")
def get_dashboard_summary(db: Session = Depends(authorized_db)) -> dict:
    return success(dashboard_summary(db))
