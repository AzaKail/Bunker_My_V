from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import uuid


def _get_trait_pools() -> dict:
    from content import (GENDERS, BUILDS, HUMAN_TRAITS, PROFESSIONS, HEALTH,
                         HOBBIES, PHOBIAS, LARGE_INVENTORY, BACKPACKS,
                         ADDITIONAL_FACTS, SPECIAL_ABILITIES, values)
    return {
        'gender':          values(GENDERS),
        'build':           values(BUILDS),
        'human_trait':     values(HUMAN_TRAITS),
        'profession':      values(PROFESSIONS),
        'health':          values(HEALTH),
        'hobby':           values(HOBBIES),
        'phobia':          values(PHOBIAS),
        'large_inventory': values(LARGE_INVENTORY),
        'backpack':        values(BACKPACKS),
        'additional_fact': values(ADDITIONAL_FACTS),
        'special_ability': values(SPECIAL_ABILITIES),
    }


class GamePhase(str, Enum):
    LOBBY = "lobby"
    PLAYING = "playing"
    VOTING = "voting"
    ELIMINATED = "eliminated"  # brief phase showing who was eliminated
    FINISHED = "finished"


class VoteResult(str, Enum):
    SURVIVAL = "survival"
    DEFEAT = "defeat"


@dataclass
class TraitReveal:
    player_id: str
    trait_key: str
    trait_value: str


@dataclass
class Player:
    id: str
    name: str
    is_host: bool = False
    is_alive: bool = True
    card: dict = field(default_factory=dict)
    revealed_traits: list = field(default_factory=list)  # list of trait keys

    def to_dict(self, include_card: bool = False, viewer_id: str = None, viewer_is_host: bool = False) -> dict:
        d = {
            "id": self.id,
            "name": self.name,
            "is_host": self.is_host,
            "is_alive": self.is_alive,
            "revealed_traits": self.revealed_traits,
        }
        # Full card only for the player themselves
        if include_card and (viewer_id == self.id or viewer_is_host):
            d["card"] = self.card
        # Revealed traits visible to everyone
        d["revealed_card"] = {k: v for k, v in self.card.items() if k in self.revealed_traits}
        return d


@dataclass
class Vote:
    voter_id: str
    target_id: str


@dataclass
class Room:
    id: str
    players: dict = field(default_factory=dict)  # player_id -> Player
    phase: GamePhase = GamePhase.LOBBY
    scenario: dict = field(default_factory=dict)
    round: int = 0
    votes: list = field(default_factory=list)  # list of Vote
    last_eliminated: Optional[str] = None  # player_id
    winner: Optional[str] = None  # "survivors" or "eliminated"
    reveal_log: list = field(default_factory=list)  # list of TraitReveal dicts

    def alive_players(self) -> list:
        return [p for p in self.players.values() if p.is_alive]

    def to_state(self, viewer_id: str) -> dict:
        """Full game state for a specific viewer."""
        viewer = self.players.get(viewer_id)
        viewer_is_host = bool(viewer and viewer.is_host)
        return {
            "room_id": self.id,
            "phase": self.phase.value,
            "scenario": self.scenario,
            "round": self.round,
            "players": [
                p.to_dict(include_card=True, viewer_id=viewer_id, viewer_is_host=viewer_is_host)
                for p in self.players.values()
            ],
            "votes": [{"voter_id": v.voter_id, "target_id": v.target_id} for v in self.votes],
            "last_eliminated": self.last_eliminated,
            "winner": self.winner,
            "reveal_log": self.reveal_log[-20:],  # last 20 reveals
            "alive_count": len(self.alive_players()),
            "bunker_capacity": self.scenario.get("capacity", 0),
        "trait_pools": _get_trait_pools(),
        }
