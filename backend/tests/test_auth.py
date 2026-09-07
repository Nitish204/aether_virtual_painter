import pytest


@pytest.mark.asyncio
async def test_signup_login_me_flow(client):
    r = await client.post("/api/auth/signup", json={"email": "a@test.com", "password": "hunter22"})
    assert r.status_code == 200
    assert "aether_session" in r.cookies

    r = await client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == "a@test.com"


@pytest.mark.asyncio
async def test_duplicate_signup_rejected(client):
    await client.post("/api/auth/signup", json={"email": "dup@test.com", "password": "hunter22"})
    r = await client.post("/api/auth/signup", json={"email": "dup@test.com", "password": "other123"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_wrong_password_rejected(client):
    await client.post("/api/auth/signup", json={"email": "b@test.com", "password": "correct-horse"})
    await client.post("/api/auth/logout")
    r = await client.post("/api/auth/login", json={"email": "b@test.com", "password": "wrong-pass"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_without_session_rejected(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_rate_limited(client):
    for _ in range(8):
        await client.post("/api/auth/login", json={"email": "rl@test.com", "password": "wrong"})
    r = await client.post("/api/auth/login", json={"email": "rl@test.com", "password": "wrong"})
    assert r.status_code == 429
