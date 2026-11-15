"""Contract tests: candidates cannot be run on a live or simulated job."""
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app
import persistent_sky as sky
from social_api.db import Base
from social_api.models import SkySearchJob


def test_candidate_endpoint_requires_completed_real_job(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite+pysqlite:///" + str(tmp_path / "candidate-api.db"),
        connect_args={"check_same_thread":False},
    )
    Base.metadata.create_all(engine)
    maker=sessionmaker(bind=engine,expire_on_commit=False)
    monkeypatch.setattr(sky,"get_session_factory",lambda:maker)
    sky._analyze_terminal_job.cache_clear()
    job_id=uuid4()
    with maker() as db:
        db.add(SkySearchJob(
            id=job_id,ra=133.7,dec=-7.2,size_arcmin=6,detector=2,
            max_frames=4,demo=False,status="queued",source="sia2",
            frame_states=[],
        ))
        db.commit()
    with TestClient(app.app) as client:
        url="/api/sky/jobs/"+str(job_id)+"/candidates"
        assert client.get(url).status_code==409
        with maker() as db:
            row=db.get(SkySearchJob,job_id)
            row.status="complete"
            row.demo=True
            row.source="simulated"
            db.commit()
        assert client.get(url).status_code==422
        with maker() as db:
            row=db.get(SkySearchJob,job_id)
            row.demo=False
            row.source="sia2"
            db.commit()
        response=client.get(url)
        assert response.status_code==200,response.text
        data=response.json()
        assert data["job_id"]==str(job_id)
        assert data["status"]=="insufficient"
        assert data["frames_used"]==0
        assert data["candidates"]==[]
        assert data["limitations"]
        assert response.headers["cache-control"]=="private, no-store"
    engine.dispose()
