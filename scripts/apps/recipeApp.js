import { MASTERCRAFTED_CONST } from "../consts.js";
import { RecipeBook } from "../documents/recipeBook.js";
import { RecipeBookConfig } from "./recipeBookConfig.js";
import { RecipeConfig } from "./recipeConfig.js";
import { Sortable } from "../lib/Sortable.js";
import { CauldronApp } from "./cauldronApp.js";

const MODULE_ID = MASTERCRAFTED_CONST.MODULE_ID;

export class RecipeApp extends FormApplication {
    constructor(actor, target = null, search = null) {
        super();
        this._target = target;
        this._search = search;
        this._actor = actor;
        if (!game.user.isGM && !this._actor) {
            const inferredActor = _token?.actor ?? game?.user?.character;
            if (inferredActor) this._actor = inferredActor;
        }
        this._firstRender = true;
        this._userMode = !game.user.isGM;
        if (this._actor) this._userMode = true;
        RecipeApp._currentApp = this;
    }

    static get RecipeBook() {
        return RecipeBook;
    }

    static get CauldronApp() {
        return CauldronApp;
    }

    static get defaultOptions() {
        return {
            ...super.defaultOptions,
            title: game.i18n.localize(`${MODULE_ID}.recipeApp.title`),
            id: `${MODULE_ID}-recipeApp`,
            classes: ["sheet", "journal-sheet", "journal-entry"],
            template: `modules/${MODULE_ID}/templates/recipeApp.hbs`,
            resizable: true,
            width: 600,
            height: 680,
            dragDrop: [{ dragSelector: null, dropSelector: null }],
        };
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        if (this._actor && Object.values({ ...(this._actor.flags[MODULE_ID] ?? {}) }).length) {
            buttons.unshift({
                class: "display-timed",
                icon: "fas fa-clock",
                label: game.i18n.localize(`${MODULE_ID}.recipeApp.timedCrafting`),
                onclick: async () => {
                    const actor = this._actor;
                    const delayedCraftings = Object.values({ ...(actor.flags[MODULE_ID] ?? {}) }).sort((a, b) => a.time - b.time);
                    const html = `
                    <div class="timed-crafting">
                    <ul class="timed-crafting-list">
                    ${delayedCraftings
                        .map((crafting) => {
                            const timeRemaining = crafting.time - game.time.worldTime;
                            //time remaining is in seconds, convert to hours and minutes
                            const hours = Math.floor(timeRemaining / 3600);
                            const minutes = Math.floor((timeRemaining % 3600) / 60);
                            const time = `${hours}h ${minutes}m`;
                            return `<li><strong>${game.i18n.localize(`${MODULE_ID}.recipeApp.readyIn`)} ${time}</strong><ul>${crafting.items.map((item) => `<li><img src="${item.img}">${item.name} (${foundry.utils.getProperty(item.system, MASTERCRAFTED_CONST.QUANTITY)})</li>`).join("")}</ul></li>`;
                        })
                        .join("")}
                    </ul></div>`;
                    new Dialog({
                        title: game.i18n.localize(`${MODULE_ID}.recipeApp.timedCrafting`),
                        content: html,
                        buttons: {
                            close: {
                                label: game.i18n.localize("Close"),
                            },
                        },
                    }).render(true);
                },
            });
        }
        if (!game.settings.get(MASTERCRAFTED_CONST.MODULE_ID, "enableCauldron")) return buttons;
        buttons.unshift({
            class: "cauldron",
            icon: "fad fa-cauldron",
            label: game.i18n.localize(`${MODULE_ID}.recipeApp.cauldron`),
            onclick: () => {
                new CauldronApp(this._actor).render(true);
            },
        });
        return buttons;
    }

    async getData() {
        let recipeBooks = game.settings.get(MODULE_ID, "recipeBooks").map((recipe) => new RecipeBook(recipe));
        for (let recipeBook of recipeBooks) {
            recipeBook.recipes = recipeBook.recipes.filter((recipe) => recipe.isOwner);
        }
        if (this._userMode) recipeBooks = recipeBooks.filter((recipeBook) => recipeBook.recipes.length > 0);
        for (let recipeBook of recipeBooks) {
            recipeBook._count = recipeBook.recipes.length;
            await recipeBook.loadDocuments();
        }
        if (!this._userMode && ui._mastercraftedRelink) {
            this.close();
            delete ui._mastercraftedRelink;
            for (let recipeBook of recipeBooks) {
                await recipeBook.saveData();
            }
            ui.notifications.info(game.i18n.localize(`${MODULE_ID}.recipeApp.relinked`));
        }
        const perm = { ...MASTERCRAFTED_CONST.CONFIG.PERMISSION_CHOICES };
        this._recipeBooks = recipeBooks;
        return { recipeBooks, perm, craftMode: this._userMode };
    }

    activateListeners(html) {
        super.activateListeners(html);
        this._contextMenu(html);
        html = html[0];
        html.addEventListener("click", this._onClick.bind(this));
        html.querySelector(`input[name="search"]`).addEventListener("keyup", this._onSearch.bind(this));
        html.querySelectorAll(".recipe-name").forEach((book) => {
            book.addEventListener("click", (e) => this._onToggleRecipe(e));
        });
        html.querySelectorAll(".mastercrafted-ingredient .mastercrafted-component.component-img").forEach((component) => {
            const recipeId = component.closest(".mastercrafted-recipe").dataset.recipeId;
            const bookId = component.closest(".mastercrafted-recipe").dataset.bookId;
            const ingredientId = component.closest(".mastercrafted-ingredient").dataset.ingredientId;
            const componentId = component.dataset.componentId;
            const uuid = component.dataset.uuid;
            const ingredientEl = component.closest(".mastercrafted-ingredient");

            component.addEventListener("click", async (event) => {
                if (event.target != component) return;
                const canInspect = RecipeBook.get(bookId).getRecipe(recipeId).canInspectIngredients;
                if (!canInspect) return;
                const item = await fromUuid(uuid);
                item.sheet.render(true);
            });
            component.addEventListener("contextmenu", async (event) => {
                if (this._userMode) {
                    if (!component.classList.contains("missing")) {
                        ingredientEl.querySelectorAll(".mastercrafted-component").forEach((c) => c.classList.remove("selected"));
                        component.classList.add("selected");
                    }
                } else {
                    RecipeBook.get(bookId).getRecipe(recipeId).removeComponent(ingredientId, componentId);
                }
            });
            if (this._userMode) return;
            component.querySelector("input").addEventListener("change", async (event) => {
                const quantity = event.target.value;
                RecipeBook.get(bookId).getRecipe(recipeId).updateComponentQuantity(ingredientId, componentId, quantity);
            });
        });

        html.querySelectorAll(".mastercrafted-result .mastercrafted-component.component-img").forEach((component) => {
            const recipeId = component.closest(".mastercrafted-recipe").dataset.recipeId;
            const bookId = component.closest(".mastercrafted-recipe").dataset.bookId;
            const resultId = component.closest(".mastercrafted-result").dataset.resultId;
            const componentId = component.dataset.componentId;
            const uuid = component.dataset.uuid;

            component.addEventListener("click", async (event) => {
                if (event.target != component) return;
                const canInspect = RecipeBook.get(bookId).getRecipe(recipeId).canInspectProducts;
                if (!canInspect) return;
                const item = await fromUuid(uuid);
                item.sheet.render(true);
            });
            if (this._userMode) return;
            component.addEventListener("contextmenu", async (event) => {
                RecipeBook.get(bookId).getRecipe(recipeId).removeProduct(resultId, componentId);
            });
            component.querySelector("input").addEventListener("change", async (event) => {
                const quantity = event.target.value;
                RecipeBook.get(bookId).getRecipe(recipeId).updateProductQuantity(resultId, componentId, quantity);
            });
        });

        if (this._userMode) {
            html.querySelector("#filter").addEventListener("click", (event) => {
                this._canCraftOnly = !this._canCraftOnly;
                if (event.target.classList.contains("fa-solid")) {
                    event.target.classList.remove("fa-solid");
                    event.target.classList.add("fa-regular");
                } else {
                    event.target.classList.remove("fa-regular");
                    event.target.classList.add("fa-solid");
                }
                this._onSearch(event);
            });
        }

        this._restoreState();
        if (this._actor) this._processRecipes();
        this._makeSortable(html);
        if (this._target) this._openToTarget(html);
        if (this._search) {
            html.querySelector(`input[name="search"]`).value = this._search;
            this._onSearch(html);
        }
    }

    _makeSortable(html) {
        if (this._userMode) return;
        new Sortable(html.querySelector(".directory-list.scrollable"), {
            dragSelector: ".recipe-book",
            dropSelector: ".recipe-book",
            animation: 100,
            onEnd: this._sortAndSave.bind(this),
        });

        const recipeEls = html.querySelectorAll(".recipe-list");
        for (let recipeEl of recipeEls) {
            new Sortable(recipeEl, {
                dragSelector: ".recipe",
                dropSelector: ".recipe",
                animation: 100,
                onEnd: this._sortAndSave.bind(this),
                setData: function (dataTransfer, dragEl) {
                    //dataTransfer.setData("text/plain", JSON.stringify({ type: "Recipe", uuid: `${dragEl.dataset.bookId}.${dragEl.dataset.recipeId}}` }));
                },
            });
        }
    }

    _saveState() {
        const state = {};
        const html = this.element[0];
        state.books = Array.from(html.querySelectorAll(".recipe-book.expanded") ?? []).map((book) => book.dataset.bookId);
        const booksScroll = html.querySelector(".directory-list.scrollable");
        state.scrollTop = booksScroll.scrollTop;
        state.recipeScrollTop =
            Array.from(html.querySelectorAll(".mastercrafted-recipe"))
                .find((e) => !e.classList.contains("hidden"))
                ?.closest("section")?.scrollTop ?? 0;
        state.activeRecipe = Array.from(html.querySelectorAll(".mastercrafted-recipe")).find((e) => !e.classList.contains("hidden"))?.dataset?.recipeId;
        this._appState = state;
    }

    _restoreState() {
        if (!this._appState) return;
        const html = this.element[0];
        Array.from(html.querySelectorAll(`.recipe-book`) ?? []).forEach((book) => {
            book.classList.toggle("expanded", this._appState.books.includes(book.dataset.bookId));
        });

        html.querySelector(`.mastercrafted-recipe[data-recipe-id="${this._appState.activeRecipe}"]`)?.classList?.toggle("hidden", false);
        const booksScroll = html.querySelector(".directory-list.scrollable");
        booksScroll.scrollTop = this._appState.scrollTop;
        Array.from(html.querySelectorAll(".mastercrafted-recipe")).forEach((recipe) => {
            if (!recipe.classList.contains("hidden")) recipe.closest("section").scrollTop = this._appState.recipeScrollTop;
        });
    }

    _openToTarget(html) {
        const { book, recipe } = RecipeApp.dataFromUUID(this._target);
        const bookId = book.id;
        const recipeId = recipe?.id;
        Array.from(html.querySelectorAll(`.recipe-book`) ?? []).forEach((book) => {
            book.classList.toggle("expanded", bookId == book.dataset.bookId);
        });
        Array.from(html.querySelectorAll(`.mastercrafted-recipe`) ?? []).forEach((recipe) => {
            recipe.classList.toggle("hidden", recipeId != recipe.dataset.recipeId);
        });
    }

    render(...args) {
        if (!this._firstRender) this._saveState();
        super.render(...args);
        this._firstRender = false;
    }

    _contextMenu(html) {
        if (this._userMode) return;
        html = html[0]

        const getBookId = (el) => el.closest(".recipe-book").dataset.bookId
        const getRecipeId = (el) => el.closest(".recipe").dataset.recipeId

        this.bookContextMenu = new foundry.applications.ux.ContextMenu.implementation(html, ".recipe-book-header", [
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.add`,
                icon: `<i class="fas fa-plus"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    RecipeBook.addRecipe(bookId);
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.edit`,
                icon: `<i class="fas fa-edit"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    RecipeBook.edit(bookId);
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.duplicate`,
                icon: `<i class="fas fa-copy"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    RecipeBook.duplicate(bookId);
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.delete`,
                icon: `<i class="fas fa-trash"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    RecipeBook.delete(bookId);
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.export`,
                icon: `<i class="fas fa-file-export"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    RecipeBook.get(bookId).export();
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.import`,
                icon: `<i class="fas fa-file-import"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    RecipeBook.get(bookId).import();
                },
            },
        ], {jQuery: false});
        this.recipeContextMenu = new foundry.applications.ux.ContextMenu.implementation(html, ".recipe", [
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.edit`,
                icon: `<i class="fas fa-edit"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    const recipeId = getRecipeId(elem)
                    new RecipeConfig(recipeId, bookId).render(true);
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.duplicate`,
                icon: `<i class="fas fa-copy"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    const recipeId = getRecipeId(elem)
                    const recipe = RecipeBook.get(bookId).getRecipe(recipeId);
                    recipe.duplicate();
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.delete`,
                icon: `<i class="fas fa-trash"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    const recipeId = getRecipeId(elem)
                    const recipe = RecipeBook.get(bookId).getRecipe(recipeId);
                    recipe.delete();
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.export`,
                icon: `<i class="fas fa-file-export"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    const recipeId = getRecipeId(elem)
                    RecipeBook.get(bookId).getRecipe(recipeId).export();
                },
            },
            {
                name: `${MODULE_ID}.recipeApp.bookcontext.import`,
                icon: `<i class="fas fa-file-import"></i>`,
                callback: async (elem) => {
                    const bookId = getBookId(elem)
                    const recipeId = getRecipeId(elem)
                    RecipeBook.get(bookId).getRecipe(recipeId).import();
                },
            },
        ],  {jQuery: false});
    }

    async _onClick(event) {
        const action = event.target.dataset.action;
        if (!action) return;
        switch (action) {
            case "createBook":
                this._createBook();
                break;
            case "toggle-recipe":
                this._toggleRecipe(event.target.closest(".recipe").dataset.recipeId);
                break;
            case "craft":
                const data = {
                    ingredients: {},
                    productId: "",
                };
                const recipeId = event.target.closest(".mastercrafted-recipe").dataset.recipeId;
                const bookId = event.target.closest(".mastercrafted-recipe").dataset.bookId;
                const recipeEl = event.target.closest(".mastercrafted-recipe");
                const ingredientsEls = recipeEl.querySelectorAll(".mastercrafted-ingredient");
                for (const ingredientEl of ingredientsEls) {
                    const ingredientId = ingredientEl.dataset.ingredientId;
                    const selectedComponent = ingredientEl.querySelector(".mastercrafted-component.selected");
                    data.ingredients[ingredientId] = selectedComponent.dataset.componentId;
                }
                data.productId = recipeEl.querySelector(".mastercrafted-result.selected").dataset.resultId;
                RecipeBook.get(bookId).getRecipe(recipeId).craft(this._actor, data, event.ctrlKey);
                break;
        }
    }

    _onSearch(event) {
        const html = this.element[0];
        const search = html.querySelector(`input[name="search"]`).value.toLowerCase();
        const showbooks = {};
        const recipes = html.querySelectorAll(".recipe");
        const books = html.querySelectorAll(".recipe-book");
        if (!search) {
            for (const book of books) {
                book.classList.remove("hidden");
                book.classList.remove("force-expanded");
            }
            for (const recipe of recipes) recipe.classList.remove("hidden");
        } else {
            for (const recipe of recipes) {
                const recipeName = recipe.querySelector(".page-title").innerText.toLowerCase();
                const recipeId = recipe.dataset.recipeId;
                const bookId = recipe.closest(".recipe-book").dataset.bookId;
                const recipeDocument = this._recipeBooks.find((book) => book.id === bookId).recipes.find((recipe) => recipe.id === recipeId);
                const innerSearchTerms = recipeDocument.ingredients
                    .map((i) => i.components.map((c) => c.name))
                    .flat()
                    .concat(recipeDocument.products.map((i) => i.components.map((c) => c.name)).flat())
                    .map((c) => c.toLowerCase());
                if (recipeName.includes(search) || innerSearchTerms.some((term) => term.includes(search))) {
                    recipe.classList.remove("hidden");
                    showbooks[bookId] = true;
                } else {
                    recipe.classList.add("hidden");
                }
            }

            for (const book of books) {
                const bookId = book.dataset.bookId;
                if (showbooks[bookId]) {
                    book.classList.remove("hidden");
                    book.classList.add("force-expanded");
                } else {
                    book.classList.add("hidden");
                }
            }
        }
        if (this._canCraftOnly) {
            for (const recipe of recipes) {
                const canCraft = recipe.querySelector(".can-craft");
                if (!canCraft) {
                    recipe.classList.add("hidden");
                }
            }
        }
    }

    async _onDrop(event) {
        const ingredientProductClosest = event.target.closest(".mastercrafted-ingredient, .mastercrafted-result");
        const isIngredient = ingredientProductClosest?.classList.contains("mastercrafted-ingredient");
        const isProduct = ingredientProductClosest?.classList.contains("mastercrafted-result");
        const isItemDrop = event.target.closest(".recipe-book");
        if (!isIngredient && !isProduct && !isItemDrop) return;
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (err) {
            return false;
        }
        if (!data.type === "Item") return;
        if (isItemDrop) {
            const item = await fromUuid(data.uuid);
            const bookId = isItemDrop.dataset.bookId;
            const book = RecipeBook.get(bookId);
            const rId = foundry.utils.randomID();
            await book.addRecipe({ id: rId, recipeBook: book, name: item.name, img: item.img });
            const recipe = RecipeBook.get(bookId).getRecipe(rId);
            recipe.addProduct(null, data.uuid, item.name);
            return;
        }
        const recipeId = ingredientProductClosest.closest(".mastercrafted-recipe").dataset.recipeId;
        const bookId = ingredientProductClosest.closest(".mastercrafted-recipe").dataset.bookId;
        const ingredientId = ingredientProductClosest.dataset.ingredientId;
        const productId = ingredientProductClosest.dataset.resultId;
        const recipe = RecipeBook.get(bookId).getRecipe(recipeId);
        const item = await fromUuid(data.uuid);
        if (isIngredient) {
            /*if(recipe.hasComponent(item.name)){
            return ui.notifications.error(game.i18n.localize(`${MODULE_ID}.recipeApp.errors.alreadyingredient`));
          }*/
            recipe.addComponent(ingredientId, data.uuid, item.name);
        }
        if (isProduct) {
            recipe.addProduct(productId, data.uuid, item.name);
        }
    }

    _onToggleRecipe(event) {
        const bookEl = event.currentTarget.closest(".recipe-book");
        bookEl.classList.toggle("expanded");
    }

    _toggleRecipe(recipeId) {
        const recipies = this.element[0].querySelectorAll(".mastercrafted-recipe");
        for (let recipe of recipies) {
            recipe.classList.toggle("hidden", recipe.dataset.recipeId !== recipeId);
        }
    }

    async _createBook() {
        new RecipeBookConfig().render(true);
    }

    async _sortAndSave(e) {
        let currentBooks = game.settings.get(MODULE_ID, "recipeBooks");
        const html = this.element[0];
        const bookEls = html.querySelectorAll(".recipe-book");
        const bookIds = Array.from(bookEls).map((book) => book.dataset.bookId);
        for (let bookEl of bookEls) {
            const bookId = bookEl.dataset.bookId;
            const recipeEls = bookEl.querySelectorAll(".recipe");
            const recipeIds = Array.from(recipeEls).map((recipeEl) => recipeEl.dataset.recipeId);
            let book = currentBooks.find((book) => book.id === bookId);
            let bookRecipies = book.recipes;
            let sortedRecipes = recipeIds.map((recipeId) => bookRecipies.find((recipe) => recipe.id === recipeId));
            book.recipes = sortedRecipes;
        }
        let sortedBooks = bookIds.map((bookId) => currentBooks.find((book) => book.id === bookId));
        currentBooks = sortedBooks;
        game.settings.set(MODULE_ID, "recipeBooks", currentBooks);
    }

    async _relink() {
        if (!this._relinked) return false;
    }

    async _processRecipes() {
        const html = this.element[0];
        const recipes = html.querySelectorAll(".mastercrafted-recipe");
        for (let recipe of recipes) {
            const recipeId = recipe.dataset.recipeId;
            const bookId = recipe.dataset.bookId;
            const recipeDoc = RecipeBook.get(bookId).getRecipe(recipeId);
            await recipeDoc.loadDocuments();
            let canCraft = false;
            let ownedIngredients = [];
            for (let ingredient of recipeDoc.ingredients) {
                const ingredientEl = recipe.querySelector(`[data-ingredient-id="${ingredient.id}"]`);
                const availebleComponents = ingredient.hasComponents(this._actor);
                let hasOneAvailable = false;
                let isOneSelected = false;
                for (let comp of availebleComponents) {
                    const componentEl = ingredientEl.querySelector(`[data-component-id="${comp.id}"]`);
                    componentEl.classList.toggle("missing", !comp.availeble);
                    hasOneAvailable = hasOneAvailable || comp.availeble;
                    if (comp.availeble && !isOneSelected) {
                        isOneSelected = true;
                        componentEl.classList.add("selected");
                    }
                }
                if (hasOneAvailable) ownedIngredients.push(ingredient);
                hasOneAvailable ? ingredientEl.classList.add("owned") : ingredientEl.classList.add("missing");
            }
            if (ownedIngredients.length === recipeDoc.ingredients.length) canCraft = true;

            const products = recipe.querySelectorAll(".mastercrafted-result");
            for (let product of products) {
                if (!canCraft) {
                    product.classList.add("missing");
                    continue;
                }
                product.style.cursor = "pointer";
                product.addEventListener("click", (event) => {
                    products.forEach((product) => product.classList.remove("selected"));
                    product.classList.add("selected");
                });
                if (product === products[0]) {
                    product.classList.add("selected");
                }
            }
            if (canCraft) {
                const recipeEntry = html.querySelector(`.directory-item.level2.recipe[data-recipe-id='${recipeId}']`);
                recipeEntry.classList.add("can-craft");
                const img = recipeEntry.querySelector("img");
                img.classList.add("can-craft");
            }
            if (!canCraft) recipe.querySelector("button.create").disabled = true;
        }
    }

    refreshCashedRecipes() {
        this._allRecipeBooks = game.settings.get(MODULE_ID, "recipeBooks").map((recipe) => new RecipeBook(recipe));
    }

    getRecipesByIngredient(ingredientName) {
        const recipes = [];
        if (!this._allRecipeBooks) this._allRecipeBooks = game.settings.get(MODULE_ID, "recipeBooks").map((recipe) => new RecipeBook(recipe));
        for (let book of this._allRecipeBooks) {
            for (let recipe of book.recipes) {
                if (recipe.hasComponent(ingredientName) || recipe.hasProduct(ingredientName)) recipes.push(recipe);
            }
        }
        return recipes;
    }

    static async processDelayedCrafting(actors) {
        let soundPlayed = false;
        for (let actor of actors) {
            const delayedCraftings = { ...(actor.flags[MODULE_ID] ?? {}) };
            if (!Object.values(delayedCraftings).length) continue;
            for (const [id, crafting] of Object.entries(delayedCraftings)) {
                const updates = [];
                const create = [];
                if (crafting.time > game.time.worldTime) continue;
                for (const itemData of crafting.items) {
                    const existingItem = actor.items.getName(itemData.name);
                    const itemQuantity = foundry.utils.getProperty(itemData, `system.${MASTERCRAFTED_CONST.QUANTITY}`);
                    if (existingItem) {
                        updates.push({ _id: existingItem.id, [`system.${MASTERCRAFTED_CONST.QUANTITY}`]: foundry.utils.getProperty(existingItem.system, MASTERCRAFTED_CONST.QUANTITY) + itemQuantity });
                    } else {
                        create.push(itemData);
                    }
                }
                if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
                if (create.length) await actor.createEmbeddedDocuments("Item", create);
                await actor.unsetFlag(MODULE_ID, id);
                if (!soundPlayed)
                    foundry.audio.AudioHelper.play({
                        src: `modules/${MASTERCRAFTED_CONST.MODULE_ID}/assets/crafting.ogg`,
                        volume: game.settings.get("core", "globalInterfaceVolume"),
                    });
                soundPlayed = true;
                ui.notifications.notify(game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.recipeApp.timedCraftCompleted`) + crafting.items.map((product) => product.name + ` (${foundry.utils.getProperty(product.system, MASTERCRAFTED_CONST.QUANTITY)})`).join(", "));
            }
        }
    }

    static dataFromUUID(uuid) {
        const [bookId, recipeId] = uuid.split(".");
        const book = RecipeBook.get(bookId) ?? RecipeBook.getName(bookId);
        if (!book) return null;
        const recipe = book.getRecipe(recipeId) ?? book.getRecipeByName(recipeId);
        return { book, recipe };
    }

    static async confirmDiscovery(event, message) {
        if (!game.user.isGM) return;
        const buttonEl = event.target;
        const userId = buttonEl.dataset.userId;
        const recipeId = buttonEl.dataset.recipeId;
        const bookId = buttonEl.dataset.bookId;
        const book = RecipeBook.get(bookId);
        const recipe = book.getRecipe(recipeId);
        const ownership = { ...recipe.ownership };
        ownership[userId] = 1;
        await recipe.update({ ownership });
        const messageContent = message.content;
        const newContent = messageContent.replace(/<button.*<\/button>/, `<i style="width: 100%; text-align: center;" class="fas fa-check"></i>`).replace(/<p.*<\/p>/, ``);
        await message.update({ content: newContent });
    }
}

export function cleanIdsRecursive(object) {
    if (!object) return;
    if (object.id) delete object.id;
    for (let [key, value] of Object.entries(object)) {
        if (typeof value === "array") {
            for (let item of value) {
                cleanIdsRecursive(item);
            }
        }
    }
    for (let key in object) {
        if (typeof object[key] === "object") {
            cleanIdsRecursive(object[key]);
        }
    }
    return object;
}
