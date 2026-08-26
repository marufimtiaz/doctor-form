from tests.conftest import auth


def _find(rows: list[dict], name: str) -> dict:
    """The lifespan seeds an admin before make_user runs, so tests must target
    the row they created rather than assume the list holds one user."""
    matches = [r for r in rows if r["name"] == name]
    assert matches, f"{name} not in {[r['name'] for r in rows]}"
    return matches[0]


async def test_user_list_is_public_and_hides_phone(client, make_user):
    await make_user(name="Karim")
    resp = await client.get("/api/users")
    assert resp.status_code == 200
    row = _find(resp.json(), "Karim")
    assert row["company"] == "FieldCo"
    assert row["role"] == "agent"
    # The picker needs names, never contact details.
    assert "phone" not in row


async def test_agent_cannot_create_users(client, make_user):
    agent = await make_user(role="agent")
    resp = await client.post(
        "/api/users",
        json={"name": "New", "phone": "01712345678", "company": "C", "role": "agent"},
        headers=auth(agent),
    )
    assert resp.status_code == 403


async def test_admin_creates_an_agent_with_a_normalized_phone(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={"name": "Karim", "phone": "017-1234 5678", "company": "FieldCo"},
        headers=auth(admin),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["role"] == "agent"

    # Stored E.164, so the same number in another format collides.
    dup = await client.post(
        "/api/users",
        json={"name": "Other", "phone": "+8801712345678", "company": "FieldCo"},
        headers=auth(admin),
    )
    assert dup.status_code == 409


async def test_admin_can_appoint_another_admin(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={"name": "Second", "phone": "01812345678", "company": "HQ", "role": "admin"},
        headers=auth(admin),
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "admin"


async def test_unparseable_phone_is_rejected(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={"name": "X", "phone": "nonsense", "company": "C"},
        headers=auth(admin),
    )
    assert resp.status_code == 422


async def test_unknown_role_is_rejected(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={"name": "X", "phone": "01912345678", "company": "C", "role": "wizard"},
        headers=auth(admin),
    )
    assert resp.status_code == 422


async def test_deactivating_a_user_locks_them_out(client, make_user):
    admin = await make_user(role="admin")
    agent = await make_user(role="agent")

    resp = await client.patch(
        f"/api/users/{agent.id}", json={"is_active": False}, headers=auth(admin)
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    # The agent's next authenticated request fails on identity, not on role.
    denied = await client.post(
        "/api/users",
        json={"name": "X", "phone": "01912345678", "company": "C"},
        headers=auth(agent),
    )
    assert denied.status_code == 401


async def test_agent_cannot_deactivate_anyone(client, make_user):
    agent = await make_user(role="agent")
    victim = await make_user(role="agent", name="Victim")
    resp = await client.patch(
        f"/api/users/{victim.id}", json={"is_active": False}, headers=auth(agent)
    )
    assert resp.status_code == 403


async def test_patching_an_unknown_user_is_a_404(client, make_user):
    from uuid import uuid4

    admin = await make_user(role="admin")
    resp = await client.patch(
        f"/api/users/{uuid4()}", json={"is_active": False}, headers=auth(admin)
    )
    assert resp.status_code == 404


async def test_first_admin_is_seeded_when_the_table_is_empty(client):
    """Identity is chosen from this list, so it cannot start empty."""
    resp = await client.get("/api/users")
    assert resp.status_code == 200
    assert [u["role"] for u in resp.json()] == ["admin"]
