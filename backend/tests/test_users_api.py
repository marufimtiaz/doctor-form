from tests.conftest import auth


def _find(rows: list[dict], name: str) -> dict:
    """The lifespan seeds an admin before make_user runs, so tests must target
    the row they created rather than assume the list holds one user."""
    matches = [r for r in rows if r["name"] == name]
    assert matches, f"{name} not in {[r['name'] for r in rows]}"
    return matches[0]


async def test_user_list_hides_phone(client, make_user):
    admin = await make_user(role="admin", name="Boss")
    await make_user(name="Karim")
    resp = await client.get("/api/users", headers=auth(admin))
    assert resp.status_code == 200
    row = _find(resp.json(), "Karim")
    assert row["company"] == "FieldCo"
    assert row["role"] == "agent"
    assert "phone" not in row
    assert "password_hash" not in row


async def test_agent_cannot_create_users(client, make_user):
    agent = await make_user(role="agent")
    resp = await client.post(
        "/api/users",
        json={
            "name": "New",
            "phone": "01712345678",
            "company": "C",
            "role": "agent",
            "password": "a-valid-password",
        },
        headers=auth(agent),
    )
    assert resp.status_code == 403


async def test_admin_creates_an_agent_with_a_normalized_phone(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={
            "name": "Karim",
            "phone": "017-1234 5678",
            "company": "FieldCo",
            "password": "a-valid-password",
        },
        headers=auth(admin),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["role"] == "agent"

    # Stored E.164, so the same number in another format collides.
    dup = await client.post(
        "/api/users",
        json={
            "name": "Other",
            "phone": "+8801712345678",
            "company": "FieldCo",
            "password": "a-valid-password",
        },
        headers=auth(admin),
    )
    assert dup.status_code == 409


async def test_admin_can_appoint_another_admin(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={
            "name": "Second",
            "phone": "01812345678",
            "company": "HQ",
            "role": "admin",
            "password": "a-valid-password",
        },
        headers=auth(admin),
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "admin"


async def test_unparseable_phone_is_rejected(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={"name": "X", "phone": "nonsense", "company": "C", "password": "a-valid-password"},
        headers=auth(admin),
    )
    assert resp.status_code == 422


async def test_unknown_role_is_rejected(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={
            "name": "X",
            "phone": "01912345678",
            "company": "C",
            "role": "wizard",
            "password": "a-valid-password",
        },
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
        json={
            "name": "X",
            "phone": "01912345678",
            "company": "C",
            "password": "a-valid-password",
        },
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
    """Identity used to be chosen from this list; now it only proves the seed ran."""
    from sqlmodel import select

    from app.db.session import SessionLocal
    from app.models.user import User

    async with SessionLocal() as session:
        result = await session.exec(select(User))
        assert [u.role for u in result.all()] == ["admin"]


async def test_listing_users_now_requires_an_admin(client, make_user):
    """It used to be public to feed the identity picker. With a login form
    there is no picker, and a public roster is a list of valid login names."""
    agent = await make_user(role="agent")
    assert (await client.get("/api/users")).status_code == 401
    assert (await client.get("/api/users", headers=auth(agent))).status_code == 403

    admin = await make_user(role="admin", name="Boss")
    assert (await client.get("/api/users", headers=auth(admin))).status_code == 200


async def test_creating_a_user_requires_a_password(client, make_user):
    admin = await make_user(role="admin", name="Boss")
    resp = await client.post(
        "/api/users",
        json={"name": "Karim", "phone": "01712345678", "company": "FieldCo"},
        headers=auth(admin),
    )
    assert resp.status_code == 422


async def test_a_created_user_can_log_in_with_the_password_the_admin_set(client, make_user):
    admin = await make_user(role="admin", name="Boss")
    resp = await client.post(
        "/api/users",
        json={
            "name": "Karim",
            "phone": "01712345678",
            "company": "FieldCo",
            "password": "handed-over-in-person",
        },
        headers=auth(admin),
    )
    assert resp.status_code == 201
    assert "password" not in resp.json()
    assert "password_hash" not in resp.json()

    login = await client.post(
        "/api/auth/login",
        json={"phone": "01712345678", "password": "handed-over-in-person"},
    )
    assert login.status_code == 200


async def test_admin_reset_logs_the_user_out_everywhere(client, make_user):
    from app.core.security import hash_password
    from app.db.session import SessionLocal
    from app.models.user import User

    admin = await make_user(role="admin", name="Boss")
    victim = await make_user(role="agent", name="Karim")
    async with SessionLocal() as session:
        row = await session.get(User, victim.id)
        row.password_hash = hash_password("forgotten-password")
        session.add(row)
        await session.commit()
        await session.refresh(row)

    victim_headers = auth(row)
    assert (await client.get("/api/auth/me", headers=victim_headers)).status_code == 200

    resp = await client.post(
        f"/api/users/{victim.id}/reset-password",
        json={"password": "a-fresh-password"},
        headers=auth(admin),
    )
    assert resp.status_code == 204

    # Their existing token is dead, the new password works, the old one does not.
    assert (await client.get("/api/auth/me", headers=victim_headers)).status_code == 401
    assert (
        await client.post(
            "/api/auth/login", json={"phone": victim.phone, "password": "a-fresh-password"}
        )
    ).status_code == 200
    assert (
        await client.post(
            "/api/auth/login", json={"phone": victim.phone, "password": "forgotten-password"}
        )
    ).status_code == 401
    # And the admin's own session is untouched.
    assert (await client.get("/api/auth/me", headers=auth(admin))).status_code == 200


async def test_an_agent_cannot_reset_anyone(client, make_user):
    agent = await make_user(role="agent")
    victim = await make_user(role="agent", name="Victim")
    resp = await client.post(
        f"/api/users/{victim.id}/reset-password",
        json={"password": "a-fresh-password"},
        headers=auth(agent),
    )
    assert resp.status_code == 403


async def test_resetting_an_unknown_user_is_a_404(client, make_user):
    from uuid import uuid4

    admin = await make_user(role="admin", name="Boss")
    resp = await client.post(
        f"/api/users/{uuid4()}/reset-password",
        json={"password": "a-fresh-password"},
        headers=auth(admin),
    )
    assert resp.status_code == 404
