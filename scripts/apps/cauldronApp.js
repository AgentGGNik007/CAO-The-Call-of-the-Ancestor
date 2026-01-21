import { MASTERCRAFTED_CONST } from "../consts.js";
import { RecipeBook } from "../documents/recipeBook.js";
import { RecipeBookConfig } from "./recipeBookConfig.js";
import { RecipeConfig } from "./recipeConfig.js";
import { Sortable } from "../lib/Sortable.js";

const MODULE_ID = MASTERCRAFTED_CONST.MODULE_ID;

export class CauldronApp extends FormApplication {
    constructor(actor) {
        super();
        this._actor = actor;
        if (!game.user.isGM && !this._actor) {
            const inferredActor = _token?.actor ?? game?.user?.character;
            if (inferredActor) this._actor = inferredActor;
        }
    }

    static get defaultOptions() {
        return {
            ...super.defaultOptions,
            title: game.i18n.localize(`${MODULE_ID}.cauldronApp.title`),
            id: `${MODULE_ID}-cauldronApp`,
            classes: [],
            template: `modules/${MODULE_ID}/templates/cauldronApp.hbs`,
            resizable: false,
            width: 400,
            dragDrop: [{ dragSelector: null, dropSelector: null }],
        };
    }

    activateListeners(html) {
        html = html[0];
        html.querySelector(".ingredients-container").addEventListener("drop", this._onDrop.bind(this));
        html.querySelector("button").addEventListener("click", this._onSubmit.bind(this));
    }

    async _updateObject() {}

    async _onSubmit(event) {
        event.preventDefault();
        const itemsData = Array.from(this.element[0].querySelectorAll(".ingredients-container .cauldron-ingredient")).map((el) => el.dataset.uuid);
        if (itemsData.length < 2) return ui.notifications.error(game.i18n.localize(`${MODULE_ID}.cauldronApp.noIngredients`));
        const items = await Promise.all(
            itemsData.map(async (uuid) => {
                const itemDoc = await fromUuid(uuid);
                if (!itemDoc) return null;
                return itemDoc;
            }),
        );
        this.brew(items);
    }

    async _onDrop(event) {
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (err) {
            return false;
        }
        if (!data.type === "Item") return;
        const item = await fromUuid(data.uuid);
        if (!item || !item.parent || item.parent !== this._actor) return;
        const container = event.target.closest(".ingredients-container") ?? event.target;
        const hasItem = container.querySelector(`[data-uuid="${data.uuid}"]`);
        if (hasItem) return;
        const placeholder = container.querySelector(".placeholder-item");
        if (placeholder) placeholder.remove();
        const img = item.img;
        const itemElement = document.createElement("div");
        itemElement.classList.add("cauldron-ingredient");
        itemElement.style.backgroundImage = `url(${img})`;
        itemElement.setAttribute("data-uuid", data.uuid);
        itemElement.setAttribute("data-name", item.name);
        itemElement.addEventListener("click", (e) => {
            itemElement.remove();
        });

        container.appendChild(itemElement);
    }

    async brew(ingredients) {
        ui.RecipeApp._currentApp.refreshCashedRecipes();
        const consumed = await this.consume(ingredients);
        if (!consumed) return this._onBrewFail();
        this.element[0].querySelector("button").disabled = true;
        let topMatch = { recipe: null, matchCount: 0 };
        let erroredOut = false;
        try {
            const matchedRecipes = Array.from(
                new Set(
                    ingredients
                        .map((i) => ui.RecipeApp._currentApp.getRecipesByIngredient(i.name))
                        .flat()
                        .filter((r) => game.user.isGM || !r?.isOwner),
                ),
            );
            const ingredientsNames = ingredients.map((i) => i.name);
            const matches = matchedRecipes.map((recipe) => {
                let matchCount = 0;
                recipe.ingredients.forEach((i) => {
                    const componentsMatch = i.components.find((c) => ingredientsNames.includes(c.name));
                    if (componentsMatch) matchCount++;
                });
                return {recipe, matchCount, matchCloseness: recipe.ingredients.length - matchCount};
            });
            const minCloseness = Math.min(...matches.map((m) => m.matchCloseness));
            topMatch = matches.find((m) => m.matchCloseness === minCloseness);
        } catch (error) {
            erroredOut = true;
        }
        const recipe = topMatch.recipe;
        if (!recipe) erroredOut = true;

        let extraCount = 0;
        let missingCount = 0;
        let matchScore = 999;

        if (recipe) {
            const extraIngredients = ingredients.filter((i) => !recipe.hasComponent(i.name));
            let missingIngredients = [];
            recipe.ingredients.forEach((i) => {
                const isSatisfied = ingredients.some((ing) => i.hasComponent(ing.name));
                if (!isSatisfied) missingIngredients.push(i);
            });

            extraCount = extraIngredients.length;
            missingCount = missingIngredients.length;
            matchScore = extraCount + missingCount;
        }

        this.element[0].querySelector(".ingredients-container").innerHTML = `<i style="font-size: 5rem" class="fa-duotone fa-cauldron fa-shake"></i>`;
        const shakes = Math.max(1, 4 - matchScore);
        for (let i = 0; i < shakes; i++) {
            const sound = Math.floor(Math.random() * 3) + 1;
            foundry.audio.AudioHelper.play({
                src: `modules/${MASTERCRAFTED_CONST.MODULE_ID}/assets/cauldron/bubble${sound}.ogg`,
                volume: game.settings.get("core", "globalInterfaceVolume"),
            });
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        this.element[0].querySelector(".ingredients-container").innerHTML = "";
        this.element[0].querySelector("button").disabled = false;

        if (erroredOut) return this._onBrewFail();
        if (matchScore === 0) return this._onBrewSuccess(recipe);
        if (matchScore > 2) return this._onBrewFail();
        return this._onBrewPartial(extraCount, missingCount, ingredients);
    }

    async consume(ingredients) {
        const itemsToUpdate = [];
        const itemsToDelete = [];
        for (const ingredient of ingredients) {
            const quantity = foundry.utils.getProperty(ingredient.system, MASTERCRAFTED_CONST.QUANTITY);
            if (quantity <= 0) return false;
            if (quantity > 1) itemsToUpdate.push({ _id: ingredient.id, [`system.${MASTERCRAFTED_CONST.QUANTITY}`]: quantity - 1 });
            else itemsToDelete.push(ingredient.id);
        }
        await this._actor.deleteEmbeddedDocuments("Item", itemsToDelete);
        await this._actor.updateEmbeddedDocuments("Item", itemsToUpdate);
        return true;
    }

    _onBrewFail() {
        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.cauldronApp.brewFail`));
    }

    async _onBrewSuccess(recipe) {
        ChatMessage.create({
            content: await renderTemplate(`modules/${MODULE_ID}/templates/brewChat.hbs`, { recipe, userId: game.user.id, success: true }),
            speaker: ChatMessage.getSpeaker({ actor: this._actor }),
            whisper: [game.user.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)],
        });
    }

    async _onBrewPartial(extra, missing, ingredients) {
        let messageKey;
        if (extra == 2) {
            messageKey = "extra2";
        } else if (missing == 2) {
            messageKey = "missing2";
        } else if (extra == 1 && missing == 1) {
            messageKey = "extra1missing1";
        } else if (extra == 1) {
            messageKey = "extra1";
        } else if (missing == 1) {
            messageKey = "missing1";
        }

        const message = game.i18n.localize(`${MODULE_ID}.cauldronApp.partial.${messageKey}`);

        ChatMessage.create({
            content: await renderTemplate(`modules/${MODULE_ID}/templates/brewChat.hbs`, { message, ingredients, userId: game.user.id, success: false }),
            speaker: ChatMessage.getSpeaker({ actor: this._actor }),
            whisper: [game.user.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)],
        });
    }
}
