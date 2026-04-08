import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import Optional
import os

import game as g
from models import GamePhase

app = FastAPI()

# WebSocket connections: room_id -> {player_id -> WebSocket}
connections: dict[str, dict[str, WebSocket]] = {}


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def send_to(ws: WebSocket, msg: dict):
    try:
        await ws.send_text(json.dumps(msg, ensure_ascii=False))
    except Exception:
        pass


async def broadcast(room_id: str, msg: dict):
    """Send message to all connected players in a room."""
    if room_id not in connections:
        return
    dead = []
    for pid, ws in connections[room_id].items():
        try:
            await ws.send_text(json.dumps(msg, ensure_ascii=False))
        except Exception:
            dead.append(pid)
    for pid in dead:
        connections[room_id].pop(pid, None)


async def broadcast_state(room_id: str):
    """Send personalized game state to each player."""
    room = g.rooms.get(room_id)
    if not room or room_id not in connections:
        return
    dead = []
    for pid, ws in connections[room_id].items():
        state = room.to_state(viewer_id=pid)
        try:
            await ws.send_text(json.dumps({"type": "state", "data": state}, ensure_ascii=False))
        except Exception:
            dead.append(pid)
    for pid in dead:
        connections[room_id].pop(pid, None)


# ─── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    player_id: Optional[str] = None
    room_id: Optional[str] = None

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            action = msg.get("action")

            # ── CREATE ROOM ──────────────────────────────────────────────────
            if action == "create_room":
                name = msg.get("name", "Игрок").strip()[:20]
                room, player = g.create_room(name)
                player_id = player.id
                room_id = room.id
                connections.setdefault(room_id, {})[player_id] = ws
                await send_to(ws, {
                    "type": "joined",
                    "player_id": player_id,
                    "room_id": room_id,
                    "is_host": True,
                })
                await broadcast_state(room_id)

            # ── JOIN ROOM ────────────────────────────────────────────────────
            elif action == "join_room":
                name = msg.get("name", "Игрок").strip()[:20]
                rid = msg.get("room_id", "").strip().upper()
                result, data = g.join_room(rid, name)
                if result is None:
                    await send_to(ws, {"type": "error", "message": data})
                else:
                    room, player = result, data
                    player_id = player.id
                    room_id = room.id
                    connections.setdefault(room_id, {})[player_id] = ws
                    await send_to(ws, {
                        "type": "joined",
                        "player_id": player_id,
                        "room_id": room_id,
                        "is_host": False,
                    })
                    await broadcast_state(room_id)

            # ── START GAME ───────────────────────────────────────────────────
            elif action == "start_game":
                room = g.rooms.get(room_id)
                if not room:
                    continue
                player = room.players.get(player_id)
                if not player or not player.is_host:
                    await send_to(ws, {"type": "error", "message": "Только хост может начать игру"})
                    continue
                ok = g.start_game(room)
                if not ok:
                    await send_to(ws, {"type": "error", "message": "Нужно минимум 3 игрока"})
                    continue
                await broadcast(room_id, {"type": "game_started"})
                await broadcast_state(room_id)

            # ── REVEAL TRAIT ─────────────────────────────────────────────────
            elif action == "reveal_trait":
                room = g.rooms.get(room_id)
                if not room:
                    continue
                trait = msg.get("trait")
                ok = g.reveal_trait(room, player_id, trait)
                if ok:
                    # Broadcast the reveal event + updated state
                    reveal = room.reveal_log[-1] if room.reveal_log else {}
                    await broadcast(room_id, {"type": "trait_revealed", "data": reveal})
                    await broadcast_state(room_id)

            # ── START VOTING ─────────────────────────────────────────────────
            elif action == "start_voting":
                room = g.rooms.get(room_id)
                if not room or room.phase != GamePhase.PLAYING:
                    continue
                player = room.players.get(player_id)
                if not player or not player.is_host:
                    await send_to(ws, {"type": "error", "message": "Только хост может начать голосование"})
                    continue
                g.start_voting(room)
                await broadcast(room_id, {"type": "voting_started"})
                await broadcast_state(room_id)

            # ── VOTE ─────────────────────────────────────────────────────────
            elif action == "vote":
                room = g.rooms.get(room_id)
                if not room or room.phase != GamePhase.VOTING:
                    continue
                target_id = msg.get("target_id")
                result = g.cast_vote(room, player_id, target_id)
                if result == "ok":
                    await broadcast_state(room_id)
                    # Auto-tally: if everyone alive voted
                    alive_ids = {p.id for p in room.alive_players()}
                    voted_ids = {v.voter_id for v in room.votes}
                    if alive_ids == voted_ids:
                        eliminated_id = g.end_voting(room)
                        if eliminated_id:
                            elim_name = room.players[eliminated_id].name
                            await broadcast(room_id, {
                                "type": "player_eliminated",
                                "player_id": eliminated_id,
                                "player_name": elim_name,
                            })
                        else:
                            await broadcast(room_id, {"type": "no_elimination"})
                        if room.phase == GamePhase.FINISHED:
                            await broadcast(room_id, {"type": "game_over", "winner": room.winner})
                        await broadcast_state(room_id)

            # ── FORCE END VOTING (host) ──────────────────────────────────────
            elif action == "end_voting":
                room = g.rooms.get(room_id)
                if not room or room.phase != GamePhase.VOTING:
                    continue
                player = room.players.get(player_id)
                if not player or not player.is_host:
                    continue
                eliminated_id = g.end_voting(room)
                if eliminated_id:
                    elim_name = room.players[eliminated_id].name
                    await broadcast(room_id, {
                        "type": "player_eliminated",
                        "player_id": eliminated_id,
                        "player_name": elim_name,
                    })
                else:
                    await broadcast(room_id, {"type": "no_elimination"})
                if room.phase == GamePhase.FINISHED:
                    await broadcast(room_id, {"type": "game_over", "winner": room.winner})
                await broadcast_state(room_id)

            # ── RESTART ──────────────────────────────────────────────────────
            elif action == "restart":
                room = g.rooms.get(room_id)
                if not room:
                    continue
                player = room.players.get(player_id)
                if not player or not player.is_host:
                    continue
                g.restart_game(room)
                await broadcast(room_id, {"type": "game_restarted"})
                await broadcast_state(room_id)

            # ── PING ─────────────────────────────────────────────────────────
            elif action == "ping":
                await send_to(ws, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WS error: {e}")
    finally:
        if room_id and player_id:
            if room_id in connections:
                connections[room_id].pop(player_id, None)
            # Notify others
            room = g.rooms.get(room_id)
            if room and player_id in room.players:
                name = room.players[player_id].name
                await broadcast(room_id, {"type": "player_left", "player_name": name, "player_id": player_id})
                # If host left, reassign
                if room.players[player_id].is_host:
                    remaining = [p for pid, p in room.players.items()
                                 if pid != player_id and pid in connections.get(room_id, {})]
                    if remaining:
                        remaining[0].is_host = True
                del room.players[player_id]
                if not room.players:
                    del g.rooms[room_id]
                else:
                    await broadcast_state(room_id)


# ─── Static files ──────────────────────────────────────────────────────────────

frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="static")
