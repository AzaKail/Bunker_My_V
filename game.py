import uuid
from models import Room, Player, GamePhase, Vote
from content import generate_player_card, generate_scenario

# In-memory storage
rooms: dict[str, Room] = {}
users: dict[str, str] = {}  # username -> password (plain for simple demo auth)


def register_user(username: str, password: str) -> tuple[bool, str]:
    username = (username or "").strip()
    password = (password or "").strip()
    if len(username) < 3:
        return False, "Логин должен быть не короче 3 символов"
    if len(password) < 4:
        return False, "Пароль должен быть не короче 4 символов"
    if username in users:
        return False, "Такой пользователь уже существует"
    users[username] = password
    return True, "Регистрация успешна"


def login_user(username: str, password: str) -> tuple[bool, str]:
    username = (username or "").strip()
    password = (password or "").strip()
    if username not in users:
        return False, "Пользователь не найден"
    if users.get(username) != password:
        return False, "Неверный пароль"
    return True, "Вход выполнен"

def create_room(host_name: str) -> tuple[Room, Player]:
    room_id = str(uuid.uuid4())[:6].upper()
    player_id = str(uuid.uuid4())
    host = Player(id=player_id, name=host_name, is_host=True)
    room = Room(id=room_id)
    room.players[player_id] = host
    rooms[room_id] = room
    return room, host


def join_room(room_id: str, player_name: str) -> tuple[Room, Player] | tuple[None, str]:
    room = rooms.get(room_id)
    if not room:
        return None, "Комната не найдена"
    if room.phase != GamePhase.LOBBY:
        return None, "Игра уже началась"
    if len(room.players) >= 12:
        return None, "Комната заполнена"

    player_id = str(uuid.uuid4())
    player = Player(id=player_id, name=player_name)
    room.players[player_id] = player
    return room, player


def start_game(room: Room) -> bool:
    if len(room.players) < 3:
        return False
    # Generate scenario based on player count
    room.scenario = generate_scenario(len(room.players))
    # Give each player a card
    for player in room.players.values():
        player.card = generate_player_card()
        player.revealed_traits = []
        player.is_alive = True
    room.phase = GamePhase.PLAYING
    room.round = 1
    room.votes = []
    room.reveal_log = []
    room.last_eliminated = None
    room.winner = None
    return True


def reveal_trait(room: Room, player_id: str, trait_key: str) -> bool:
    VALID_TRAITS = {
        "race", "gender", "build", "human_trait", "profession", "health",
        "hobby", "phobia", "large_inventory", "backpack",
        "additional_fact", "special_ability",
    }
    player = room.players.get(player_id)
    if not player or not player.is_alive:
        return False
    if trait_key not in VALID_TRAITS:
        return False
    if trait_key in player.revealed_traits:
        return False  # already revealed

    player.revealed_traits.append(trait_key)
    room.reveal_log.append({
        "player_id": player_id,
        "player_name": player.name,
        "trait_key": trait_key,
        "trait_value": player.card[trait_key],
    })
    return True


def cast_vote(room: Room, voter_id: str, target_id: str) -> str:
    """Returns 'ok', 'already_voted', 'invalid'"""
    voter = room.players.get(voter_id)
    target = room.players.get(target_id)
    if not voter or not voter.is_alive:
        return "invalid"
    if not target or not target.is_alive:
        return "invalid"
    if voter_id == target_id:
        return "invalid"

    # Remove previous vote from this voter
    room.votes = [v for v in room.votes if v.voter_id != voter_id]
    room.votes.append(Vote(voter_id=voter_id, target_id=target_id))
    return "ok"


def tally_votes(room: Room) -> str | None:
    """Returns eliminated player_id if majority reached, else None."""
    alive = room.alive_players()
    alive_ids = {p.id for p in alive}
    # Only count votes from alive players targeting alive players
    valid_votes = [v for v in room.votes if v.voter_id in alive_ids and v.target_id in alive_ids]

    counts: dict[str, int] = {}
    for v in valid_votes:
        counts[v.target_id] = counts.get(v.target_id, 0) + 1

    if not counts:
        return None

    majority = len(alive) // 2 + 1
    for pid, count in counts.items():
        if count >= majority:
            return pid
    return None


def eliminate_player(room: Room, player_id: str) -> None:
    player = room.players.get(player_id)
    if player:
        player.is_alive = False
    room.last_eliminated = player_id
    room.votes = []
    room.round += 1
    # Check win condition
    _check_winner(room)


def _check_winner(room: Room) -> None:
    alive = room.alive_players()
    capacity = room.scenario.get("capacity", 0)

    if len(alive) <= capacity:
        room.phase = GamePhase.FINISHED
        room.winner = "survivors"
    elif len(alive) <= 1:
        room.phase = GamePhase.FINISHED
        room.winner = "eliminated"


def start_voting(room: Room) -> None:
    room.phase = GamePhase.VOTING
    room.votes = []


def end_voting(room: Room) -> str | None:
    """Force-end voting, return eliminated id or None."""
    eliminated_id = tally_votes(room)
    if eliminated_id:
        eliminate_player(room, eliminated_id)
        if room.phase != GamePhase.FINISHED:
            room.phase = GamePhase.PLAYING
    else:
        # No majority - no elimination, back to playing
        room.votes = []
        room.phase = GamePhase.PLAYING
    return eliminated_id


def restart_game(room: Room) -> None:
    for player in room.players.values():
        player.card = {}
        player.revealed_traits = []
        player.is_alive = True
    room.phase = GamePhase.LOBBY
    room.scenario = {}
    room.round = 0
    room.votes = []
    room.reveal_log = []
    room.last_eliminated = None
    room.winner = None


def override_trait(room: "Room", target_id: str, trait_key: str, new_value: str) -> bool:
    """Host changes any trait value for any player."""
    from content import (RACES, GENDERS, BUILDS, HUMAN_TRAITS, PROFESSIONS, HEALTH,
                         HOBBIES, PHOBIAS, LARGE_INVENTORY, BACKPACKS,
                         ADDITIONAL_FACTS, SPECIAL_ABILITIES, values)
    POOLS = {
        "race":            RACES,
        "gender":          values(GENDERS),
        "build":           values(BUILDS),
        "human_trait":     values(HUMAN_TRAITS),
        "profession":      values(PROFESSIONS),
        "health":          values(HEALTH),
        "hobby":           values(HOBBIES),
        "phobia":          values(PHOBIAS),
        "large_inventory": values(LARGE_INVENTORY),
        "backpack":        values(BACKPACKS),
        "additional_fact": values(ADDITIONAL_FACTS),
        "special_ability": values(SPECIAL_ABILITIES),
    }
    player = room.players.get(target_id)
    if not player or trait_key not in POOLS:
        return False
    if new_value not in POOLS[trait_key]:
        return False
    player.card[trait_key] = new_value
    # If that trait is in reveal_log, update the logged value too
    for entry in room.reveal_log:
        if entry["player_id"] == target_id and entry["trait_key"] == trait_key:
            entry["trait_value"] = new_value
    return True


def hide_trait(room: "Room", player_id: str, trait_key: str) -> bool:
    """Player hides a previously revealed trait from others."""
    player = room.players.get(player_id)
    if not player or trait_key not in player.revealed_traits:
        return False
    player.revealed_traits.remove(trait_key)
    return True
