import { clamp } from "../game/config";
import type { Stock } from "../game/types";

export type RetailPressure = {
  buyPressure: number;
  sellPressure: number;
};

export function updateRetailProfile(stock: Stock): void {
  const retail = stock.retail;
  const dayChangePct = getDayChangePct(stock);
  const positiveTrend = Math.max(0, stock.momentum - 18);
  const negativeTrend = Math.max(0, -stock.momentum - 24);
  const deepLossDay = Math.max(0, -dayChangePct - 4);
  const hotPanic = stock.heat > 65 && retail.fear > 72;
  const neutralGreed = clamp(34 + stock.sentiment * 0.28 + stock.financialHealth * 0.05, 25, 70);
  const neutralFear = clamp(48 - stock.sentiment * 0.18 - stock.financialHealth * 0.06, 18, 62);

  if (stock.boardState === "sealedLimitUp") {
    const trauma = clamp((retail.fear + retail.panicSellers - retail.greed * 0.25 + stock.heat * 0.18) / 175, 0, 0.82);
    retail.greed = clamp(retail.greed + 0.08 + 0.32 * (1 - trauma), 0, 100);
    retail.attention = clamp(retail.attention + 0.28 + 0.22 * (1 - trauma), 0, 100);
    retail.boardFaith = clamp(retail.boardFaith + 0.1 + 0.42 * (1 - trauma), 0, 100);
    retail.fear = clamp(retail.fear - (0.035 + 0.26 * (1 - trauma)), 0, 100);
    retail.panicSellers = clamp(retail.panicSellers - (0.03 + 0.22 * (1 - trauma)), 0, 100);
  } else if (stock.boardState === "weakSeal") {
    retail.greed = clamp(retail.greed + 0.35, 0, 100);
    retail.fear = clamp(retail.fear + 1.4, 0, 100);
    retail.boardFaith = clamp(retail.boardFaith - 1.5, 0, 100);
  } else if (stock.boardState === "brokenBoard" || stock.boardState === "panic") {
    retail.fear = clamp(retail.fear + 2.4 + deepLossDay * 0.42 + (hotPanic ? 1.4 : 0), 0, 100);
    retail.panicSellers = clamp(retail.panicSellers + 2 + Math.max(0, -dayChangePct - 5) * 0.42 + (hotPanic ? 1.2 : 0), 0, 100);
    retail.greed = clamp(retail.greed - 0.9 - deepLossDay * 0.06, 0, 100);
    retail.boardFaith = clamp(retail.boardFaith - 3.1 - deepLossDay * 0.1, 0, 100);
  } else if (stock.boardState === "limitDown") {
    retail.fear = clamp(retail.fear + 3.4, 0, 100);
    retail.panicSellers = clamp(retail.panicSellers + 3, 0, 100);
    retail.greed = clamp(retail.greed - 1.9, 0, 100);
  } else {
    const loosePanic = dayChangePct < -5.5 && (negativeTrend > 8 || retail.fear > 72);
    retail.greed = clamp(
      retail.greed * 0.978 + neutralGreed * 0.022 + positiveTrend * 0.012 - negativeTrend * 0.006 - (loosePanic ? deepLossDay * 0.05 : 0),
      0,
      100
    );
    retail.fear = clamp(
      retail.fear * 0.978 +
        neutralFear * 0.022 +
        negativeTrend * 0.014 -
        positiveTrend * 0.012 -
        Math.max(0, dayChangePct) * 0.075 -
        retail.greed * 0.004 +
        (loosePanic ? deepLossDay * 0.32 : 0),
      0,
      100
    );
    retail.panicSellers = clamp(
      retail.panicSellers * 0.984 +
        28 * 0.016 +
        Math.max(0, -dayChangePct - 4) * 0.42 -
        Math.max(0, dayChangePct - 1) * 0.11 -
        retail.dipBuyers * 0.008 +
        (loosePanic ? deepLossDay * 0.28 : 0),
      0,
      100
    );
    retail.boardFaith = clamp(retail.boardFaith * 0.986 + 34 * 0.014 + Math.max(0, dayChangePct - 5) * 0.25, 0, 100);
    retail.attention = clamp(retail.attention * 0.988 + stock.attention * 0.012, 0, 100);
  }
}

export function applyBoardStateTransitionEffects(stock: Stock, previousState: string): void {
  if (previousState === stock.boardState) return;

  const retail = stock.retail;

  if (stock.boardState === "sealedLimitUp") {
    const trauma = clamp((retail.fear + retail.panicSellers - retail.greed * 0.2 + stock.heat * 0.16) / 165, 0, 0.85);
    retail.greed = clamp(retail.greed + 1.1 + 2.4 * (1 - trauma), 0, 100);
    retail.attention = clamp(retail.attention + 1.4 + 1.6 * (1 - trauma), 0, 100);
    retail.boardFaith = clamp(retail.boardFaith + 1.8 + 4.2 * (1 - trauma), 0, 100);
    retail.fear = clamp(retail.fear - (0.8 + 3.2 * (1 - trauma)), 0, 100);
    retail.panicSellers = clamp(retail.panicSellers - (0.55 + 1.95 * (1 - trauma)), 0, 100);
    stock.sentiment = clamp(stock.sentiment + 1 + 2 * (1 - trauma), 0, 100);
    stock.attention = clamp(stock.attention + 0.8 + 1.4 * (1 - trauma), 0, 100);
  }

  if (stock.boardState === "weakSeal") {
    retail.boardFaith = clamp(retail.boardFaith - 3, 0, 100);
    retail.fear = clamp(retail.fear + 1.5, 0, 100);
  }

  if (stock.boardState === "brokenBoard") {
    retail.boardFaith = clamp(retail.boardFaith - 8, 0, 100);
    retail.fear = clamp(retail.fear + 5.5, 0, 100);
    retail.panicSellers = clamp(retail.panicSellers + 4.5, 0, 100);
    stock.sentiment = clamp(stock.sentiment - 4.5, 0, 100);
  }
}

export function calculateRetailPressure(stock: Stock, newsImpact: number): RetailPressure {
  const dayChangePct = getDayChangePct(stock);
  const positiveMomentum = Math.max(0, stock.momentum - 12);
  const negativeMomentum = Math.max(0, -stock.momentum - 26);
  const effectiveGreed = Math.max(0, stock.retail.greed - stock.retail.fear * 0.32);
  const effectiveFear = Math.max(0, stock.retail.fear - stock.retail.greed * 0.44);
  const effectivePanic = Math.max(0, stock.retail.panicSellers - stock.retail.dipBuyers * 0.32 - stock.retail.greed * 0.12);
  const dipDemand = Math.max(0, -dayChangePct - 2.5) * stock.retail.dipBuyers * (0.35 + stock.financialHealth / 180);
  const panicMultiplier =
    1 +
    Math.pow(clamp((stock.retail.fear - 62) / 38, 0, 1), 1.25) * 1.2 +
    Math.pow(clamp((stock.heat - 62) / 38, 0, 1), 1.1) * 0.75;
  const greedMultiplier =
    1 +
    Math.pow(clamp((stock.retail.greed - 72) / 28, 0, 1), 1.18) * 0.42 +
    Math.pow(clamp((stock.heat - 72) / 28, 0, 1), 1.1) * 0.32;

  return {
    buyPressure:
      stock.currentLiquidity *
      ((effectiveGreed * 0.0012 +
        stock.retail.attention * 0.0008 +
        stock.retail.boardFaith * 0.0007 +
        positiveMomentum * 0.00055 +
        dipDemand * 0.00009 +
        Math.max(0, newsImpact) * 0.001) /
        10) *
        greedMultiplier,
    sellPressure:
      stock.currentLiquidity *
      ((effectiveFear * 0.0012 +
        effectivePanic * 0.0009 +
        negativeMomentum * 0.0007 +
        Math.max(0, -newsImpact) * 0.0012) /
        10) *
        panicMultiplier
  };
}

function getDayChangePct(stock: Stock): number {
  return ((stock.price - stock.previousClose) / stock.previousClose) * 100;
}
