"""SIA2 vs TAP metadata comparison: offline contract and endpoint tests."""
from __future__ import annotations

from xml.sax.saxutils import escape

import pytest
from fastapi.testclient import TestClient

import app as explorer
import sia2_compare as sia


def fits_url(release: str, detector: int, number: int) -> str:
    return (
        f"https://irsa.ipac.caltech.edu/ibe/data/spherex/{release}/level2/"
        f"2025W19_1B/l2b-v1/2/frame{number}_1D{detector}.fits"
    )


def rec(url, mjd=60810):
    return {"url": url + "?center=133.795129,-7.245147d&size=0.1",
            "mjd": mjd, "date": f"2025-05-01T00:00:{mjd % 60:02d}",
            "release": "DR1" if "/dr1/" in url else "QR3"}


def votable(rows, query_status="OK"):
    fields = (
        '<FIELD name="access_url" datatype="char" arraysize="*"/>'
        '<FIELD name="energy_bandpassname" datatype="char" arraysize="*"/>'
        '<FIELD name="t_min" datatype="double"/>'
    )
    data = "".join(
        f"<TR><TD>{escape(url)}</TD><TD>{escape(band)}</TD><TD>{mjd}</TD></TR>"
        for url, band, mjd in rows
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<VOTABLE xmlns="http://www.ivoa.net/xml/VOTable/v1.3" version="1.3">'
        '<RESOURCE type="results">'
        f'<INFO name="QUERY_STATUS" value="{query_status}"/>'
        f"<TABLE>{fields}<DATA><TABLEDATA>{data}</TABLEDATA></DATA></TABLE>"
        "</RESOURCE></VOTABLE>"
    ).encode("utf-8")


class Response:
    def __init__(self, data, status=200):
        self.content = data
        self.status_code = status


@pytest.fixture()
def benchmark(monkeypatch):
    a = fits_url("dr1", 2, 1)
    b = fits_url("dr1", 2, 2)
    c = fits_url("qr3", 2, 3)
    d = fits_url("dr1", 4, 4)
    captured = []

    def fake_get(url, **kwargs):
        captured.append((url, kwargs))
        return Response(votable([
            (a, "SPHEREx-D2", 60801.5),
            (b, "SPHEREx-D2", 60802.5),
            (b, "SPHEREx-D2", 60802.5),  # duplicate
            (c, "SPHEREx-D2", 60803.5),
            (d, "SPHEREx-D4", 60804.5),  # wrong detector
            ("https://not-irsa.example/evil.fits", "SPHEREx-D2", 60805.5),
        ]))

    monkeypatch.setattr(sia.requests, "get", fake_get)
    return captured, a, b, c


def test_sia2_query_filters_detector_validates_links_and_deduplicates(benchmark):
    captured, a, b, c = benchmark
    out = sia.query_sia2(133.795129, -7.245147, 6, 2)
    assert out["query_status"] == "OK"
    assert out["complete"]
    assert out["raw_rows"] == 6
    assert out["matching_detector_rows"] == 5
    assert out["valid_cutout_rows"] == 4
    assert len(out["records"]) == 3
    assert out["discarded"]["duplicate_fits_path"] == 1
    assert out["discarded"]["invalid_or_nonlocal_cutout"] == 1
    assert {r["path"] for r in out["records"]} == {
        sia.fits_path(a), sia.fits_path(b), sia.fits_path(c)
    }
    assert all(r["date"] for r in out["records"])
    url, kwargs = captured[0]
    assert url == "https://irsa.ipac.caltech.edu/SIA"
    assert kwargs["allow_redirects"] is False
    assert kwargs["timeout"] == (5, 30)
    pairs = kwargs["params"]
    assert ("MAXREC", "5000") in pairs
    assert sum(k == "COLLECTION" for k, _ in pairs) == 4
    assert ("POS", "CIRCLE 133.795129 -7.245147 0.0002777777777777778") in pairs


def test_comparison_uses_full_tap_catalog_not_only_selected_epochs(benchmark):
    _, a, b, c = benchmark
    out = sia.query_sia2(133.795129, -7.245147, 6, 2)
    tap = [rec(a, 60801), rec(b, 60802), rec(fits_url("dr1", 2, 5), 60805)]
    result = sia.compare_with_tap(out, tap, tap[:1])
    assert result["tap"]["unique_images"] == 3
    assert result["tap"]["selected_epochs"] == 1
    assert result["sia2"]["unique_compatible_images"] == 3
    assert result["overlap"]["matched"] == 2
    assert result["overlap"]["tap_only"] == 1
    assert result["overlap"]["sia2_only"] == 1
    assert result["overlap"]["selected_tap_matched"] == 1
    assert result["comparable"] is True
    assert len(result["overlap"]["tap_only_examples"]) == 1
    assert len(result["overlap"]["sia2_only_examples"]) == 1
    # Source URLs must never be returned to the browser.
    assert "https://irsa.ipac.caltech.edu/ibe/" not in str(result)


def test_sia2_overflow_is_labeled_incomplete(monkeypatch):
    monkeypatch.setattr(sia.requests, "get", lambda *_a, **_kw:
                        Response(votable([(fits_url("dr1", 2, 1), "SPHEREx-D2", 60801)],
                                         query_status="OVERFLOW")))
    result = sia.compare_with_tap(
        sia.query_sia2(10, 11, 6, 2),
        [rec(fits_url("dr1", 2, 1))],
        [rec(fits_url("dr1", 2, 1))],
    )
    assert not result["comparable"]
    assert any("incompletos" in x for x in result["caveats"])


def test_sia2_query_status_error_is_not_treated_as_success(monkeypatch):
    monkeypatch.setattr(sia.requests, "get", lambda *_a, **_kw:
                        Response(votable([], query_status="ERROR")))
    with pytest.raises(sia.Sia2ComparisonError, match="QUERY_STATUS=ERROR"):
        sia.query_sia2(10, 11, 6, 2)


def test_sia2_unexpected_http_is_rejected(monkeypatch):
    monkeypatch.setattr(sia.requests, "get", lambda *_a, **_kw: Response(b"", status=503))
    with pytest.raises(sia.Sia2ComparisonError, match="HTTP 503"):
        sia.query_sia2(10, 11, 6, 2)


def test_cutout_validation_does_not_allow_arbitrary_hosts_or_old_releases():
    assert sia.cutout_compatible(fits_url("dr1", 2, 1), 10, 20, 6)
    assert not sia.cutout_compatible("https://evil.example/ibe/data/spherex/dr1/level2/a.fits", 10, 20, 6)
    assert not sia.cutout_compatible("https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/a.fits", 10, 20, 6)
    assert not sia.cutout_compatible(fits_url("dr1", 2, 1) + "?already=yes", 10, 20, 6)


def test_sia2_endpoint_uses_existing_catalog_and_caches_results(benchmark, monkeypatch):
    client = TestClient(explorer.app)
    _, a, b, c = benchmark
    tap = [rec(a), rec(b), rec(fits_url("dr1", 2, 5))]
    token = explorer.register_session(explorer.Session(
        133.795129, -7.245147, 6, 2, tap[:2], "irsa",
        catalog_records=tap,
    ))
    calls = []
    original = explorer.query_sia2

    def count_calls(*args):
        calls.append(args)
        return original(*args)

    monkeypatch.setattr(explorer, "query_sia2", count_calls)
    result = client.get(f"/api/diagnostics/sia2/{token}")
    assert result.status_code == 200
    payload = result.json()
    assert payload["source"] == "sia2_vs_tap"
    assert payload["tap"]["unique_images"] == 3
    assert payload["overlap"]["matched"] == 2
    assert payload["query"]["detector"] == 2
    assert result.headers["cache-control"] == "private, no-store"
    assert client.get(f"/api/diagnostics/sia2/{token}").json() == payload
    assert len(calls) == 1


def test_sia2_endpoint_rejects_demo_and_missing_ticket():
    client = TestClient(explorer.app)
    demo = explorer.register_session(explorer.Session(10, 11, 6, 2, [], "simulated"))
    assert client.get(f"/api/diagnostics/sia2/{demo}").status_code == 422
    assert client.get("/api/diagnostics/sia2/not-a-ticket").status_code == 404
