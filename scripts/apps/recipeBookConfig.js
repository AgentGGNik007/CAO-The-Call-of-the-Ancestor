import { MASTERCRAFTED_CONST } from "../consts.js";
import { RecipeBook } from "../documents/recipeBook.js";

const MODULE_ID = MASTERCRAFTED_CONST.MODULE_ID;

export class RecipeBookConfig extends FormApplication{

    constructor(recipeBook){
        super();
        this.recipeBook = recipeBook;
    }

    getTitle(){
      let title = this.recipeBook ? game.i18n.localize(`${MODULE_ID}.recipeApp.editcreatebook.edit`) : game.i18n.localize(`${MODULE_ID}.recipeApp.editcreatebook.create`);
      title += " " + game.i18n.localize(`${MODULE_ID}.recipeApp.editcreatebook.book`);
      if(this.recipeBook) title += ": " + this.recipeBook.name;
      return title;
    }

    async _render(...args){
        await super._render(...args);
        document.querySelector("#mastercrafted-recipeBookConfig .window-title").innerHTML = this.getTitle();
    }

    static get defaultOptions() {
        return {
          ...super.defaultOptions,
          title: "",
          id: `${MODULE_ID}-recipeBookConfig`,
          template: `modules/${MODULE_ID}/templates/recipeBookConfig.hbs`,
          width: 400,
        };
      }
  
      async getData() {
        const perm = {...MASTERCRAFTED_CONST.CONFIG.PERMISSION_CHOICES};
        delete perm[0];
        const users = Array.from(game.users).filter(u => !u.isGM).map((u) => {
          return {
              id: u.id,
              name: u.name,
              permission: this.recipeBook ? this.recipeBook.ownership[u.id] : 2,
              choices: perm
          };
        })
        const data = {users, choices: perm};
        if(!this.recipeBook) return data;
        return {...data, ...this.recipeBook.toObject()};
      }

      async _onSubmit(event, {updateData=null, preventClose=false, preventRender=false}={}) {
        event.preventDefault();
        const formData = foundry.utils.expandObject(this._getSubmitData(updateData));
        if(!formData.name) return ui.notifications.error(game.i18n.localize(`${MODULE_ID}.recipeApp.errors.namemissing`));
        let currentBooks = game.settings.get(MODULE_ID, "recipeBooks");
        if(!this.recipeBook){
          const recipeBook = new RecipeBook(formData).toObject();
          currentBooks.push(recipeBook);
          game.settings.set(MODULE_ID, "recipeBooks", currentBooks);
        }else{
          const recipeBook = RecipeBook.get(this.recipeBook.id);
          recipeBook.update(formData);
        }
        this.close();
      }
}