import pytest

# A real, valid 1x1 transparent PNG, base64-encoded — small enough to
# keep tests fast while still exercising the actual save/fetch path
# with a genuine PNG payload rather than arbitrary text.
TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


async def _signup_and_get_csrf(client, email="d@test.com"):
    r = await client.post("/api/auth/signup", json={"email": email, "password": "hunter22"})
    assert r.status_code == 200
    return client.cookies.get("aether_csrf")


@pytest.mark.asyncio
async def test_save_and_list_drawing(client):
    csrf = await _signup_and_get_csrf(client)

    r = await client.post(
        "/api/drawings",
        json={"image_base64": TINY_PNG_B64, "tool": "draw", "color": "#FF3C3C", "thickness": 5},
        headers={"x-csrf-token": csrf},
    )
    assert r.status_code == 200

    r = await client.get("/api/drawings")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["tool"] == "draw"
    assert items[0]["color"] == "#FF3C3C"


@pytest.mark.asyncio
async def test_save_without_csrf_header_rejected(client):
    await _signup_and_get_csrf(client, email="e@test.com")
    r = await client.post(
        "/api/drawings",
        json={"image_base64": TINY_PNG_B64, "tool": "draw", "color": "#FFFFFF", "thickness": 5},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_get_and_delete_drawing(client):
    csrf = await _signup_and_get_csrf(client, email="f@test.com")
    save = await client.post(
        "/api/drawings",
        json={"image_base64": TINY_PNG_B64, "tool": "erase", "color": "#FFFFFF", "thickness": 10},
        headers={"x-csrf-token": csrf},
    )
    drawing_id = save.json()["id"]

    r = await client.get(f"/api/drawings/{drawing_id}")
    assert r.status_code == 200
    assert r.json()["image_base64"] == TINY_PNG_B64

    r = await client.delete(f"/api/drawings/{drawing_id}", headers={"x-csrf-token": csrf})
    assert r.status_code == 200

    r = await client.get(f"/api/drawings/{drawing_id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cannot_access_another_users_drawing(client):
    csrf_a = await _signup_and_get_csrf(client, email="userA@test.com")
    save = await client.post(
        "/api/drawings",
        json={"image_base64": TINY_PNG_B64, "tool": "draw", "color": "#000000", "thickness": 3},
        headers={"x-csrf-token": csrf_a},
    )
    drawing_id = save.json()["id"]

    await client.post("/api/auth/logout")
    csrf_b = await _signup_and_get_csrf(client, email="userB@test.com")

    r = await client.get(f"/api/drawings/{drawing_id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_invalid_tool_rejected(client):
    csrf = await _signup_and_get_csrf(client, email="g@test.com")
    r = await client.post(
        "/api/drawings",
        json={"image_base64": TINY_PNG_B64, "tool": "not-a-real-tool", "color": "#FFFFFF", "thickness": 5},
        headers={"x-csrf-token": csrf},
    )
    assert r.status_code == 422
