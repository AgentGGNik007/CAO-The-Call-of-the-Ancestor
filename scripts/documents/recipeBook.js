import { Recipe } from "./recipe.js";
import { MASTERCRAFTED_CONST } from "../consts.js";
import { RecipeBookConfig } from "../apps/recipeBookConfig.js";
import { RecipeConfig } from "../apps/recipeConfig.js";
import { cleanIdsRecursive } from "../apps/recipeApp.js";

const MODULE_ID = MASTERCRAFTED_CONST.MODULE_ID;

export class RecipeBook {
    constructor({ id = null, recipes = [], tools = "", name = "", description = "", sound = "", ownership = {}, ingredientsInspection = 0, productInspection = 0, img = MASTERCRAFTED_CONST.RECIPE_BOOK.IMG }) {
        this.id = id ?? foundry.utils.randomID();
        this.ownership = ownership;
        this.documentName = "RecipeBook";
        this.name = name;
        this.sound = sound;
        this.description = description;
        this.ingredientsInspection = ingredientsInspection;
        this.productInspection = productInspection;
        this.img = img || MASTERCRAFTED_CONST.RECIPE_BOOK.IMG;
        this.tools = tools;
        this.recipes = recipes.map((recipe) => new Recipe({ ...recipe, recipeBook: this }));
        this._count = this.recipes.length;
    }

    get isOwner() {
        if (game.user.isGM) return true;
        const userId = game.user.id;
        return this.ownership[userId] == 1 || this.ownership[userId] === undefined;
    }

    get document() {
        return game.settings.get(MODULE_ID, "recipeBooks").find((book) => book.id === this.id);
    }

    async loadDocuments() {
        for (let recipe of this.recipes) {
            await recipe.loadDocuments();
        }
    }

    async update(data) {
        for (let key in data) {
            this[key] = data[key];
        }
        await this.saveData();
    }

    getRecipe(id) {
        return this.recipes.find((recipe) => recipe.id === id);
    }

    getRecipeByName(name) {
        return this.recipes.find((recipe) => recipe.name === name);
    }

    async addRecipe(data = null) {
        if (data) data.recipeBook = this;
        const recipe = new Recipe(data ?? { recipeBook: this, name: game.i18n.localize(`${MODULE_ID}.UI.default-recipe-name`) });
        this.recipes.push(recipe);
        await this.saveData();
    }

    async updateRecipe(id, data) {
        const recipe = this.getRecipe(id);
        recipe.update(data);
    }

    async saveData() {
        let currentBooks = game.settings.get(MODULE_ID, "recipeBooks");
        let bookIndex = currentBooks.findIndex((book) => book.id === this.id);
        if (!currentBooks[bookIndex]) {
            currentBooks.push(this.toObject());
        } else {
            currentBooks[bookIndex] = this.toObject();
        }
        await game.settings.set(MODULE_ID, "recipeBooks", currentBooks);
    }

    toObject() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            ownership: this.ownership,
            tools: this.tools,
            ingredientsInspection: this.ingredientsInspection,
            productInspection: this.productInspection,
            recipes: this.recipes.map((recipe) => recipe.toObject()),
            img: this.img,
            sound: this.sound,
        };
    }

    export() {
        let data = this.toObject();
        data = cleanIdsRecursive(data);
        data.documentName = this.documentName;
        saveDataToFile(JSON.stringify(data, null, 2), "text/json", `mastercrafted-${this.documentName}-${this.name.slugify()}.json`);
    }

    async import() {
        new Dialog(
            {
                title: `Import Data: ${this.name}`,
                content: await renderTemplate("templates/apps/import-data.hbs", {
                    hint1: game.i18n.format("DOCUMENT.ImportDataHint1", { document: this.documentName }),
                    hint2: game.i18n.format("DOCUMENT.ImportDataHint2", { name: this.name }),
                }),
                buttons: {
                    import: {
                        icon: '<i class="fas fa-file-import"></i>',
                        label: "Import",
                        callback: (html) => {
                            const form = html.find("form")[0];
                            if (!form.data.files.length) return ui.notifications.error("You did not upload a data file!");
                            readTextFromFile(form.data.files[0]).then((json) => this.importFromJSON(json));
                        },
                    },
                    no: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                    },
                },
                default: "import",
            },
            {
                width: 400,
            },
        ).render(true);
    }

    async importFromJSON(json) {
        let data = JSON.parse(json);
        if (!data.documentName === this.documentName) return ui.notifications.error("This is not a valid recipe book data file!");
        const book = new RecipeBook({ ...data, id: this.id });
        await this.update(book);
    }

    static delete(id) {
        Dialog.confirm({
            title: game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.UI.delete-recipe-book-title`),
            content: game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.UI.delete-recipe-book-content`),
            yes: () => {
                let currentBooks = game.settings.get(MODULE_ID, "recipeBooks");
                currentBooks = currentBooks.filter((book) => book.id !== id);
                game.settings.set(MODULE_ID, "recipeBooks", currentBooks);
            },
            defaultYes: false,
        });
    }

    static edit(id) {
        let currentBooks = game.settings.get(MODULE_ID, "recipeBooks");
        let book = new RecipeBook(currentBooks.find((book) => book.id === id));
        new RecipeBookConfig(book).render(true);
    }

    static async duplicate(id) {
        let currentBooks = game.settings.get(MODULE_ID, "recipeBooks");
        let book = currentBooks.find((book) => book.id === id);
        let newBook = new RecipeBook(book).toObject();
        newBook = cleanIdsRecursive(newBook);
        newBook = new RecipeBook(newBook).toObject();
        newBook.id = foundry.utils.randomID();
        currentBooks.push(newBook);
        await game.settings.set(MODULE_ID, "recipeBooks", currentBooks);
    }

    static async addRecipe(id, data = null) {
        new RecipeConfig(null, id).render(true);
    }

    static get(id) {
        let currentBooks = game.settings.get(MODULE_ID, "recipeBooks");
        const bookData = currentBooks.find((book) => book.id === id);
        if (!bookData) return null;
        return new RecipeBook(bookData);
    }

    static getName(name) {
        let currentBooks = game.settings.get(MODULE_ID, "recipeBooks");
        const bookData = currentBooks.find((book) => book.name === name);
        if (!bookData) return null;
        return new RecipeBook(bookData);
    }
}
