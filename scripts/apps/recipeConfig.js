import { MASTERCRAFTED_CONST } from "../consts.js";
import { RecipeBook } from "../documents/recipeBook.js";
import { Recipe } from "../documents/recipe.js";

const MODULE_ID = MASTERCRAFTED_CONST.MODULE_ID;

export class RecipeConfig extends FormApplication{

    constructor(recipe, bookId){
        super();
        this.recipe = recipe;
        if(typeof recipe === "string"){
          this.recipe = RecipeBook.get(bookId).getRecipe(this.recipe);
        }
        this.bookId = bookId;
    }

    getTitle(){
      let title = this.recipe ? game.i18n.localize(`${MODULE_ID}.recipeApp.editcreatebook.edit`) : game.i18n.localize(`${MODULE_ID}.recipeApp.editcreatebook.create`);
      title += " " + game.i18n.localize(`${MODULE_ID}.recipeApp.editcreatebook.recipe`);
      if(this.recipe) title += ": " + this.recipe.name;
      return title;
    }

    async _render(...args){
        await super._render(...args);
        document.querySelector("#mastercrafted-recipeConfig .window-title").innerHTML = this.getTitle();
    }

    static get defaultOptions() {
        return {
          ...super.defaultOptions,
          title: "",
          id: `${MODULE_ID}-recipeConfig`,
          template: `modules/${MODULE_ID}/templates/recipeBookConfig.hbs`,
          width: 400,
        };
      }
  
      async getData() {
        const perm = {...MASTERCRAFTED_CONST.CONFIG.PERMISSION_CHOICES};
        const users = Array.from(game.users).filter(u => !u.isGM).map((u) => {
          return {
              id: u.id,
              name: u.name,
              permission: this.recipe ? this.recipe.ownership[u.id] : 0,
              choices: perm
          };
        })
        const data = {users, choices: perm};
        if(!this.recipe) return data;
        return {...data, ...this.recipe.toObject(), isRecipe: true};
      }

      async _onSubmit(event, {updateData=null, preventClose=false, preventRender=false}={}) {
        event.preventDefault();
        const formData = foundry.utils.expandObject(this._getSubmitData(updateData));
        if(!formData.name) return ui.notifications.error(game.i18n.localize(`${MODULE_ID}.recipeApp.errors.namemissing`));

        const book = RecipeBook.get(this.bookId);
        this.recipe ? await book.getRecipe(this.recipe.id).update(formData) : await book.addRecipe(formData)

        this.close();
      }
}