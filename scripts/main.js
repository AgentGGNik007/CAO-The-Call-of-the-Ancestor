/**
 * CAO | The Call of the Ancestors
 * scripts/main.js
 *
 * Background logic only (hooks + flags).
 *
 * Activities:
 *   options.activity.flags["cao-action"] = "hm-cast" | "hm-move" | "ff-cast"
 *
 * Weapon:
 *   Item flags: flags.cao.weapon = true (or legacy flags["cao-weapon"] = true)
 *
 * Token flags (new + legacy):
 *   flags.cao.hm = { casterUuid: string, itemUuid?: string }
 *   flags.cao.ff = { casterUuid: string, itemUuid?: string }
 *   flags.cao["cao-hm-token"] = true   (legacy)
 *   flags.cao["cao-ff-token"] = true   (legacy)
 *
 * Concentration effect flags:
 *   flags.cao["hm-target-uuid"] = <TokenDocument UUID>
 *   flags.cao["ff-target-uuid"] = <TokenDocument UUID>
 */

const CAO_NS = "cao";

// Legacy token flags (kept for backward compatibility)
const HM_TOKEN_FLAG_LEGACY = "cao-hm-token";
const FF_TOKEN_FLAG_LEGACY = "cao-ff-token";

// New token flags
const HM_TOKEN_FLAG = "hm";
const FF_TOKEN_FLAG = "ff";

// Effect flags stored on the Concentration ActiveEffect
const HM_EFFECT_FLAG = "hm-target-uuid";
const FF_EFFECT_FLAG = "ff-target-uuid";

/* -------------------------------------------- */
/* Small helpers                                 */
/* -------------------------------------------- */

function caoSpeaker(actor) {
  return ChatMessage.getSpeaker({ actor });
}

async function caoChat(content, actor = null) {
  return ChatMessage.create({
    content,
    speaker: actor ? caoSpeaker(actor) : ChatMessage.getSpeaker()
  });
}

function caoGetFirstTargetToken() {
  return Array.from(game.user.targets ?? [])[0] ?? null;
}

function caoGetCaoAction(item, options = {}) {
  const a = options?.activity;
  return a?.flags?.["cao-action"] ?? a?.flags?.caoAction ?? a?.getFlag?.(CAO_NS, "action") ?? null;
}

function caoIsCaoWeapon(item) {
  return !!(item?.getFlag?.(CAO_NS, "weapon") || item?.getFlag?.("cao-weapon"));
}

function caoIsUseMag(item) {
  return !!(item?.getFlag?.(CAO_NS, "use-magazin") || item?.getFlag?.("cao-use-magazin"));
}

function caoGetUseMags(actor) {
  const mags = actor.items.filter(caoIsUseMag);
  const equipped = mags.filter(m => !!m.system?.equipped);
  const notEquipped = mags.filter(m => !m.system?.equipped);
  return { mags, equipped, notEquipped };
}

function caoGetMagDamageType(mag) {
  // preferred: flags.cao.damageType = "piercing" | "lightning" | "poison" | "cold"
  const f = mag?.flags ?? {};
  const cao = f.cao ?? {};
  return (
    cao.damageType ??
    cao["damage-type"] ??
    cao["cao-damage"] ??
    f["cao-damage"] ??
    "piercing"
  );
}

async function caoConsumeShot(mag) {
  const uses = mag.system?.uses ?? {};
  const max = Number(uses.max ?? 0);
  const spent = Number(uses.spent ?? 0);

  // If max not set, treat as infinite
  if (!max) return;

  if (spent >= max) return;
  await mag.update({ "system.uses.spent": spent + 1 });
}

function caoBuildDamageParts(magType) {
  // Standard base always
  const parts = [["1d10 + @mod", "piercing"]];

  // Elemental bonus for non-standard ammo
  if (magType === "lightning") parts.push(["1d8", "lightning"]);
  if (magType === "poison") parts.push(["1d8", "poison"]);
  if (magType === "cold") parts.push(["1d8", "cold"]);

  return parts;
}

async function caoApplyCondition(targetActor, statusId, originUuid) {
  if (!targetActor) return;

  const already = targetActor.effects?.some(e => {
    const s = e.statuses;
    if (!s) return false;
    if (typeof s.has === "function") return s.has(statusId);
    return Array.isArray(s) ? s.includes(statusId) : false;
  });

  if (already) return;

  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: statusId === "poisoned" ? "Poisoned" : "Restrained",
    img: "icons/svg/aura.svg",
    origin: originUuid,
    statuses: [statusId],
    disabled: false,
    changes: [],
    duration: {}
  }]);
}

async function caoPostButtonCard({ actor, title, buttonLabel, action, payload, extraLine }) {
  return ChatMessage.create({
    speaker: actor ? caoSpeaker(actor) : ChatMessage.getSpeaker(),
    content: `
      <div class="dnd5e chat-card">
        <header class="card-header"><h3>${title}</h3></header>
        <div class="card-content">${extraLine ? `<p>${extraLine}</p>` : ``}</div>
        <footer class="card-footer">
          <button type="button" data-cao-action="${action}">${buttonLabel}</button>
        </footer>
      </div>
    `,
    flags: { cao: payload }
  });
}

/* -------------------------------------------- */
/* Concentration helpers                         */
/* -------------------------------------------- */

function caoIsConcentrationEffect(effect) {
  return effect?.statuses?.has?.("concentrating")
    || effect?.statuses?.includes?.("concentrating")
    || effect?.label === "Concentration"
    || effect?.name === "Concentration";
}

async function caoEnsureConcentrationEffect(actor, item, { seconds = 60 } = {}) {
  const existing = actor.effects.find(e => caoIsConcentrationEffect(e));
  if (existing) return existing;

  const effectData = {
    name: "Concentration",
    label: "Concentration",
    icon: "icons/svg/aura.svg",
    origin: item?.uuid,
    disabled: false,
    statuses: ["concentrating"],
    duration: { seconds }
  };

  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
  return created ?? null;
}

// Cleanup token flags when concentration ends
Hooks.on("deleteActiveEffect", async (effect) => {
  try {
    const actor = effect?.parent;
    if (!actor) return;

    const hmTargetUuid = effect.getFlag?.(CAO_NS, HM_EFFECT_FLAG);
    if (hmTargetUuid) {
      const targetDoc = await fromUuid(hmTargetUuid);
      if (targetDoc) {
        await targetDoc.unsetFlag(CAO_NS, HM_TOKEN_FLAG);
        await targetDoc.unsetFlag(CAO_NS, HM_TOKEN_FLAG_LEGACY);
      }
    }

    const ffTargetUuid = effect.getFlag?.(CAO_NS, FF_EFFECT_FLAG);
    if (ffTargetUuid) {
      const targetDoc = await fromUuid(ffTargetUuid);
      if (targetDoc) {
        await targetDoc.unsetFlag(CAO_NS, FF_TOKEN_FLAG);
        await targetDoc.unsetFlag(CAO_NS, FF_TOKEN_FLAG_LEGACY);
      }
    }
  } catch (e) {
    console.error("CAO | deleteActiveEffect cleanup failed", e);
  }
});

/* -------------------------------------------- */
/* HM / FF logic                                 */
/* -------------------------------------------- */

async function caoHandleHMCast({ item, actor }) {
  const target = caoGetFirstTargetToken();
  if (!target) {
    await caoChat("Zielen nicht vergessen", actor);
    return;
  }

  await target.document.setFlag(CAO_NS, HM_TOKEN_FLAG, { casterUuid: actor.uuid, itemUuid: item.uuid });
  await target.document.setFlag(CAO_NS, HM_TOKEN_FLAG_LEGACY, true);

  const conc = await caoEnsureConcentrationEffect(actor, item, { seconds: 3600 });
  if (!conc) return;

  await conc.setFlag(CAO_NS, HM_EFFECT_FLAG, target.document.uuid);
}

async function caoHandleHMMove({ item, actor }) {
  const target = caoGetFirstTargetToken();
  if (!target) {
    await caoChat("Zielen nicht vergessen", actor);
    return;
  }

  const conc = actor.effects.find(e => caoIsConcentrationEffect(e));
  if (!conc) {
    ui.notifications.warn("CAO: Keine Konzentration aktiv.");
    return;
  }

  const prevUuid = conc.getFlag(CAO_NS, HM_EFFECT_FLAG);
  if (prevUuid) {
    const prev = await fromUuid(prevUuid);
    if (prev) {
      await prev.unsetFlag(CAO_NS, HM_TOKEN_FLAG);
      await prev.unsetFlag(CAO_NS, HM_TOKEN_FLAG_LEGACY);
    }
  }

  await target.document.setFlag(CAO_NS, HM_TOKEN_FLAG, { casterUuid: actor.uuid, itemUuid: item.uuid });
  await target.document.setFlag(CAO_NS, HM_TOKEN_FLAG_LEGACY, true);
  await conc.setFlag(CAO_NS, HM_EFFECT_FLAG, target.document.uuid);
}

async function caoHandleFFCast({ item, actor }) {
  const target = caoGetFirstTargetToken();
  if (!target) {
    await caoChat("Zielen nicht vergessen", actor);
    return;
  }

  const save = await target.actor?.rollAbilitySave?.("dex", { chatMessage: true, fastForward: false });
  if (!save) return;

  const dc = actor.system?.attributes?.spelldc ?? actor.system?.attributes?.spell?.dc ?? null;
  if (dc == null) {
    ui.notifications.warn("CAO: Spell DC nicht gefunden.");
    return;
  }

  if ((save.total ?? 0) >= dc) return;

  await target.document.setFlag(CAO_NS, FF_TOKEN_FLAG, { casterUuid: actor.uuid, itemUuid: item.uuid });
  await target.document.setFlag(CAO_NS, FF_TOKEN_FLAG_LEGACY, true);

  const conc = await caoEnsureConcentrationEffect(actor, item, { seconds: 60 });
  if (!conc) return;

  await conc.setFlag(CAO_NS, FF_EFFECT_FLAG, target.document.uuid);
}

/* -------------------------------------------- */
/* Weapon logic (CAO weapon)                     */
/* -------------------------------------------- */

const CAO_WEAPON_PENDING = new Map(); // key userId -> { weaponUuid, targetTokenUuid, magType, attackerActorUuid }

async function caoHandleWeaponUse({ item, actor }) {
  const targetToken = caoGetFirstTargetToken();

  // Target check
  if (!targetToken) {
    await caoChat("Zielen nicht vergessen", actor);
    return;
  }

  // Disposition check
  const disp = targetToken.document?.disposition;
  if (disp === 1) {
    await caoChat("Auf die eigenen leute zielen das sind mir die richtigen", actor);
    return;
  }

  // Inventory scan
  const { mags, equipped, notEquipped } = caoGetUseMags(actor);

  if (equipped.length > 1) {
    await caoChat("wer hat dir erlaubt mehr als 1 magazin zu laden", actor);
    return;
  }

  if (mags.length < 1) {
    await caoChat("du hast noch nciht nachgeladen", actor);
    return;
  }

  if (equipped.length < 1 && notEquipped.length >= 1) {
    ui.notifications.error("du hast vergessen ein magazion zu equuippen");
    return;
  }

  const mag = equipped[0];
  const magType = caoGetMagDamageType(mag);

  // FF hint only (as requested)
  const ff = targetToken.document?.getFlag?.(CAO_NS, FF_TOKEN_FLAG) || targetToken.document?.getFlag?.(CAO_NS, FF_TOKEN_FLAG_LEGACY);
  if (ff) await caoChat("dein ziel leuchtet besonders hell heute", actor);

  // Vanilla attack roll UI
  await item.rollAttack({ configureDialog: true });

  // Consume shot after attack roll
  await caoConsumeShot(mag);

  // Store pending for this user (so the chat buttons can open correct damage UI)
  CAO_WEAPON_PENDING.set(game.user.id, {
    weaponUuid: item.uuid,
    targetTokenUuid: targetToken.document.uuid,
    magType,
    attackerActorUuid: actor.uuid
  });

  // Post button to open vanilla damage roll UI
  await caoPostButtonCard({
    actor,
    title: item.name,
    buttonLabel: "Damage",
    action: "cao-weapon-roll-damage",
    payload: { kind: "cao-weapon", userId: game.user.id },
    extraLine: null
  });
}

// Handle chat buttons (no macros)
Hooks.on("renderChatMessage", (message, html) => {
  try {
    const root = html?.[0];
    if (!root) return;

    root.querySelectorAll?.("button[data-cao-action]")?.forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        const action = ev.currentTarget?.dataset?.caoAction;
        const f = message.flags?.cao;
        if (!action || !f || f.kind !== "cao-weapon") return;
        if (f.userId !== game.user.id) return;

        const pending = CAO_WEAPON_PENDING.get(game.user.id);
        if (!pending) return;

        const weapon = await fromUuid(pending.weaponUuid);
        const targetDoc = await fromUuid(pending.targetTokenUuid);
        if (!weapon || !targetDoc) return;

        if (action === "cao-weapon-roll-damage") {
          const parts = caoBuildDamageParts(pending.magType);

          const original = foundry.utils.duplicate(weapon.system.damage.parts);
          try {
            await weapon.update({ "system.damage.parts": parts });
            await weapon.rollDamage({ configureDialog: true, critical: false });
          } finally {
            await weapon.update({ "system.damage.parts": original });
          }

          // Apply conditions (PSN/COLD) after damage roll is made
          const targetActor = targetDoc.actor;
          if (pending.magType === "poison") await caoApplyCondition(targetActor, "poisoned", weapon.uuid);
          if (pending.magType === "cold") await caoApplyCondition(targetActor, "restrained", weapon.uuid);

          // HM button only for the attacker who cast HM (casterUuid === attacker actor)
          const hmNew = targetDoc.getFlag?.(CAO_NS, HM_TOKEN_FLAG);              // { casterUuid, itemUuid? }
          const hmLegacy = targetDoc.getFlag?.(CAO_NS, HM_TOKEN_FLAG_LEGACY);    // true/false (alt)

          let hmAppliesToThisAttacker = false;

          // New standard: check casterUuid matches attacker
          if (hmNew && typeof hmNew === "object" && hmNew.casterUuid) {
            hmAppliesToThisAttacker = (hmNew.casterUuid === pending.attackerActorUuid);
          }

          // Legacy fallback: check concentration binding on attacker
          if (!hmAppliesToThisAttacker && hmLegacy) {
            const conc = weapon.actor.effects?.find(e => caoIsConcentrationEffect(e));
            const bound = conc?.getFlag?.(CAO_NS, HM_EFFECT_FLAG);
            hmAppliesToThisAttacker = (bound === targetDoc.uuid);
          }

          if (hmAppliesToThisAttacker) {
            await caoPostButtonCard({
              actor: weapon.actor,
              title: "Hunter’s Mark",
              buttonLabel: "Bonus Damage (1d6)",
              action: "cao-weapon-roll-hm",
              payload: { kind: "cao-weapon", userId: game.user.id, hm: true },
              extraLine: null
            });
          }
        }

        if (action === "cao-weapon-roll-hm") {
          const original = foundry.utils.duplicate(weapon.system.damage.parts);
          try {
            await weapon.update({ "system.damage.parts": [["1d6", "piercing"]] });
            await weapon.rollDamage({ configureDialog: true, critical: false });
          } finally {
            await weapon.update({ "system.damage.parts": original });
          }
        }
      });
    });
  } catch (e) {
    console.error("CAO | renderChatMessage handler failed", e);
  }
});

/* -------------------------------------------- */
/* Central dispatcher via dnd5e preUseItem        */
/* -------------------------------------------- */

Hooks.on("dnd5e.preUseItem", async (item, config, options) => {
  try {
    const actor = item?.actor;
    if (!actor) return;

    // Weapon: always ours when flagged
    if (caoIsCaoWeapon(item)) {
      await caoHandleWeaponUse({ item, actor, config, options });
      return false; // prevent default item use
    }

    // Activity-based actions (HM/FF)
    const action = caoGetCaoAction(item, options);
    if (!action) return;

    // Guard: prevent consumption; we handle logic ourselves
    config.consumeSpellSlot = false;
    config.consumeUsage = false;
    config.consumeQuantity = false;
    config.consumeRecharge = false;

    if (action === "hm-cast") {
      await caoHandleHMCast({ item, actor, config, options });
      return false;
    }

    if (action === "hm-move") {
      await caoHandleHMMove({ item, actor, config, options });
      return false;
    }

    if (action === "ff-cast") {
      await caoHandleFFCast({ item, actor, config, options });
      return false;
    }
  } catch (e) {
    console.error("CAO | dnd5e.preUseItem failed", e);
  }
});
