import { describe, expect, it } from "vitest";
import { canBeatDaBanZiHand, analyzeDaBanZiHand } from "@doudizhu/shared";
import { DaBanZiRoomManager } from "./daBanZiRoomManager.js";
import { GameException } from "./roomManager.js";

function createFullRoom(rng: () => number = () => 0.31) {
  const manager = new DaBanZiRoomManager(rng);
  const room = manager.createRoom("s1", "甲");
  manager.joinRoom("s2", room.roomCode, "乙");
  manager.joinRoom("s3", room.roomCode, "丙");
  manager.joinRoom("s4", room.roomCode, "丁");
  manager.ready("s1");
  manager.ready("s2");
  manager.ready("s3");
  manager.ready("s4");
  return { manager, room };
}

function socketBySeat(room: ReturnType<DaBanZiRoomManager["getRoomForTest"]>) {
  if (!room) {
    throw new Error("Missing room");
  }
  const entries = room.players
    .filter((player): player is NonNullable<(typeof room.players)[number]> => Boolean(player))
    .map((player) => [player.seat, player.socketId] as const);
  return new Map(entries);
}

function passBaoStage(manager: DaBanZiRoomManager, room: NonNullable<ReturnType<DaBanZiRoomManager["getRoomForTest"]>>) {
  const bySeat = socketBySeat(room);
  while (room.phase === "bao") {
    const currentSeat = room.baoCurrentSeat;
    if (currentSeat === undefined) {
      throw new Error("Missing bao current seat");
    }
    manager.chooseBao(bySeat.get(currentSeat) ?? "", "pass");
  }
}

describe("DaBanZiRoomManager", () => {
  it("creates a four-player room and enters bao choice after all players ready", () => {
    const { room } = createFullRoom();

    expect(room.playerCount).toBe(4);
    expect(room.phase).toBe("bao");
    expect(room.players.every((player) => player?.hand.length === 13)).toBe(true);
    expect(room.baoCurrentSeat).toBeDefined();
  });

  it("rejects out-of-turn bao choices", () => {
    const { manager, room } = createFullRoom();
    const wrongSeat = ((room.baoCurrentSeat ?? 0) + 1) % 4;
    const bySeat = socketBySeat(room);

    expect(() => manager.chooseBao(bySeat.get(wrongSeat) ?? "", "pass")).toThrow(GameException);
  });

  it("starts one-vs-three when a player chooses bao and then rotates normally", () => {
    const { manager, room } = createFullRoom();
    const bySeat = socketBySeat(room);
    const baoSeat = room.baoCurrentSeat ?? 0;
    const baoSocket = bySeat.get(baoSeat) ?? "";

    manager.chooseBao(baoSocket, "bao");
    expect(room.phase).toBe("playing");
    expect(room.mode).toBe("one_vs_three");
    expect(room.freeLeadRemaining).toBe(0);
    expect(room.currentTurn).toBe(baoSeat);

    const firstCard = room.players[baoSeat]?.hand[0];
    if (!firstCard) {
      throw new Error("Missing first card");
    }
    manager.playCards(baoSocket, [firstCard.id]);

    expect(room.players[baoSeat]?.collectedCount).toBe(0);
    expect(room.lastPlay?.seat).toBe(baoSeat);
    expect(room.freeLeadRemaining).toBe(0);
    expect(room.currentTurn).toBe((baoSeat + 1) % 4);

    manager.pass(bySeat.get(room.currentTurn ?? -1) ?? "");
    expect(room.currentTurn).toBe((baoSeat + 2) % 4);
  });

  it("passes all bao choices into hidden partner-call mode", () => {
    const { manager, room } = createFullRoom();
    passBaoStage(manager, room);

    expect(room.phase).toBe("partner_call");
    expect(room.bankerSeat).toBeDefined();
    expect(room.partnerCallOptions.length).toBeGreaterThan(0);

    const banker = room.players[room.bankerSeat ?? -1];
    expect(banker?.hand.some((card) => card.id === "spades-7")).toBe(true);
  });

  it("keeps partner identity hidden until the called card is played", () => {
    const { manager, room } = createFullRoom();
    passBaoStage(manager, room);
    const bySeat = socketBySeat(room);
    const bankerSeat = room.bankerSeat ?? 0;
    const bankerSocket = bySeat.get(bankerSeat) ?? "";
    const option = room.partnerCallOptions[0];

    manager.callPartner(bankerSocket, option.rank, option.suit);
    expect(room.phase).toBe("playing");
    expect(room.partnerSeat).toBeDefined();
    expect(room.partnerRevealed).toBe(false);

    const bankerView = manager.buildViews(room).find((view) => view.socketId === bankerSocket)?.roomView;
    const partnerSocket = bySeat.get(room.partnerSeat ?? -1) ?? "";
    const partnerView = manager.buildViews(room).find((view) => view.socketId === partnerSocket)?.roomView;

    expect(bankerView?.partnerSeat).toBeUndefined();
    expect(partnerView?.partnerSeat).toBe(room.partnerSeat);
    expect(partnerView?.players.find((player) => player.seat === room.partnerSeat)?.role).toBe("partner");
  });

  it("collects the trick after all other active players pass", () => {
    const { manager, room } = createFullRoom();
    passBaoStage(manager, room);
    const bySeat = socketBySeat(room);
    const bankerSeat = room.bankerSeat ?? 0;
    const bankerSocket = bySeat.get(bankerSeat) ?? "";
    manager.callPartner(bankerSocket, room.partnerCallOptions[0].rank, room.partnerCallOptions[0].suit);

    const firstCard = room.players[bankerSeat]?.hand[0];
    if (!firstCard) {
      throw new Error("Missing banker card");
    }
    manager.playCards(bankerSocket, [firstCard.id]);

    for (let index = 0; index < 3; index += 1) {
      const seat = room.currentTurn;
      if (seat === undefined) {
        throw new Error("Missing current turn");
      }
      manager.pass(bySeat.get(seat) ?? "");
    }

    expect(room.lastPlay).toBeUndefined();
    expect(room.players[bankerSeat]?.collectedCount).toBe(1);
    expect(room.currentTurn).toBe(bankerSeat);
  });

  it("keeps asking every other player to beat or pass after someone plays their last card", () => {
    const { manager, room } = createFullRoom();
    passBaoStage(manager, room);
    const bySeat = socketBySeat(room);
    const bankerSeat = room.bankerSeat ?? 0;
    const bankerSocket = bySeat.get(bankerSeat) ?? "";
    manager.callPartner(bankerSocket, room.partnerCallOptions[0].rank, room.partnerCallOptions[0].suit);

    const finalCard = room.players[bankerSeat]?.hand[0];
    if (!finalCard) {
      throw new Error("Missing banker card");
    }
    room.players[bankerSeat]!.hand = [finalCard];

    manager.playCards(bankerSocket, [finalCard.id]);
    expect(room.players[bankerSeat]?.hand).toHaveLength(0);
    expect(room.lastPlay?.seat).toBe(bankerSeat);
    expect(room.players[bankerSeat]?.collectedCount).toBe(0);
    expect(room.phase).toBe("playing");

    const firstPassSeat = room.currentTurn;
    if (firstPassSeat === undefined) {
      throw new Error("Missing first pass seat");
    }
    manager.pass(bySeat.get(firstPassSeat) ?? "");
    expect(room.lastPlay?.seat).toBe(bankerSeat);
    expect(room.players[bankerSeat]?.collectedCount).toBe(0);

    const secondPassSeat = room.currentTurn;
    if (secondPassSeat === undefined) {
      throw new Error("Missing second pass seat");
    }
    manager.pass(bySeat.get(secondPassSeat) ?? "");
    expect(room.lastPlay?.seat).toBe(bankerSeat);
    expect(room.players[bankerSeat]?.collectedCount).toBe(0);

    const thirdPassSeat = room.currentTurn;
    if (thirdPassSeat === undefined) {
      throw new Error("Missing third pass seat");
    }
    manager.pass(bySeat.get(thirdPassSeat) ?? "");
    expect(room.lastPlay).toBeUndefined();
    expect(room.players[bankerSeat]?.collectedCount).toBe(1);
    expect(room.currentTurn).not.toBe(bankerSeat);
  });

  it("uses the same pressure relation as the shared rule engine", () => {
    const triple = analyzeDaBanZiHand([
      { id: "a", suit: "spades", rank: "3", value: 3, label: "3", suitSymbol: "♠", color: "black" },
      { id: "b", suit: "hearts", rank: "3", value: 3, label: "3", suitSymbol: "♥", color: "red" },
      { id: "c", suit: "clubs", rank: "3", value: 3, label: "3", suitSymbol: "♣", color: "black" }
    ]);
    const pair = analyzeDaBanZiHand([
      { id: "d", suit: "spades", rank: "2", value: 15, label: "2", suitSymbol: "♠", color: "black" },
      { id: "e", suit: "hearts", rank: "2", value: 15, label: "2", suitSymbol: "♥", color: "red" }
    ]);

    expect(canBeatDaBanZiHand(triple, pair)).toBe(true);
  });
});
