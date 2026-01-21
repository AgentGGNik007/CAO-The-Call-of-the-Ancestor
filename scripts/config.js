import {MASTERCRAFTED_CONST} from './consts.js';
import { RecipeApp } from './apps/recipeApp.js';
import {RecipeBook} from './documents/recipeBook.js';
import { ItemConfig } from './apps/itemConfig.js';


Hooks.once('setup', () => { 
  CONFIG.TextEditor.enrichers.push({
    id: MASTERCRAFTED_CONST.MODULE_ID,
    pattern: /@mastercrafted\[(.*?)\]/g,
    enricher: (match, content) => { 
      try{
      const [bid, rid] = match[1].split(".");
      const { book, recipe } = ui.RecipeApp.dataFromUUID(match[1]);
      const a = document.createElement("a")
      a.classList.add("content-link");
      a.draggable = true;
      const recipeUUID = `${bid}.${rid}`;
      a.dataset.recipeUUID = recipeUUID;
      a.dataset.tooltip = recipe?.name ?? book.name;
      a.innerHTML = `<i class="fas fa-${recipe ? "hammer" : "book"}"></i> ${recipe?.name ?? book.name}`;
        return a;
      } catch (e) {
        const a = document.createElement("a");
        a.classList.add("content-link");
        a.draggable = true;
        a.innerHTML = `<i class="fas fa-hammer"></i> Error Parsing Tag`;
        return a;
      }
    },
  })
  $(document).on("click", ".content-link[data-recipe-u-u-i-d]", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const a = e.currentTarget;
    const recipeUUID = a.dataset.recipeUUID;
    const {book, recipe} = ui.RecipeApp.dataFromUUID(recipeUUID);
    if(!book.isOwner || (recipe && !recipe.isOwner)) return ui.notifications.error(game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.UI.no-permission`));
    new ui.RecipeApp(_token?.actor ?? game.user.character, recipeUUID).render(true);
  });
})

Hooks.once('init', () => {
  globalThis.ui.RecipeApp = RecipeApp;
  

    game.settings.register(MASTERCRAFTED_CONST.MODULE_ID, "recipeBooks", {
        name: "",
        hint: "",
        scope: "world",
        config: false,
        type: Array,
        default: [],
        onChange: () => {
          const rApp = Object.values(ui.windows).find(w => w instanceof RecipeApp);
          if(rApp && !rApp._relinked) rApp.render(true);
        }
    });
  
    game.settings.register(MASTERCRAFTED_CONST.MODULE_ID, "enableCauldron", {
      name: `${MASTERCRAFTED_CONST.MODULE_ID}.settings.enableCauldron.name`,
      hint: `${MASTERCRAFTED_CONST.MODULE_ID}.settings.enableCauldron.hint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
    });
  
    game.settings.register(MASTERCRAFTED_CONST.MODULE_ID, "customQuantityPath", {
      name: `${MASTERCRAFTED_CONST.MODULE_ID}.settings.customQuantityPath.name`,
      hint: `${MASTERCRAFTED_CONST.MODULE_ID}.settings.customQuantityPath.hint`,
      scope: "world",
      config: true,
      type: String,
      default: "",
    });
  
    let hookId = null;
    hookId = Hooks.on("renderChatMessage", (message, html) => {
      if (!game.user.isGM) {
        Hooks.off("renderChatMessage", hookId);
        return;
      }
      const confirmButton = html[0].querySelector(".confirm-recipe-discovery");
      if (!confirmButton) return;
      confirmButton.addEventListener("click", (e) => {
        ui.RecipeApp.confirmDiscovery(e, message);
      });
    })

});

Hooks.once("ready", () => {
  const app = new RecipeApp();
  app.getData();
  ItemConfig.setHooks();
});

Hooks.on("renderItemDirectory", (app, html) => {
  const buttonContainer = html.querySelector(".header-actions.action-buttons");
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add(`${MASTERCRAFTED_CONST.MODULE_ID}-open-recipe-app`);
  button.innerHTML = `<i class="fas fa-book"></i><span>${game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.UI.open-recipe-app`)}</span>`;
  button.onclick = () => {
    new RecipeApp().render(true);
  }
  buttonContainer.appendChild(button);
})

Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
  if (app.object.isOwner) {    
    buttons.unshift({
      label: "mastercrafted.craft",
      class: "mastercrafted",
      icon: "fas fa-hammer",
      onclick: () => {new RecipeApp(app.object).render(true);}
    });
    ui.RecipeApp.processDelayedCrafting([app.object])
  }
})

Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  if (app.document && app.document.isOwner) {    
    controls.push({
      label: "mastercrafted.craft",
      action: "mastercrafted",
      icon: "fas fa-hammer",
      onClick: () => {new RecipeApp(app.document).render(true);}
    });
    ui.RecipeApp.processDelayedCrafting([app.document])
  }
});

Hooks.on("getItemSheetHeaderButtons", (app, buttons) => {
  if (ui.RecipeApp._currentApp.getRecipesByIngredient(app.object.name).length) {    
    buttons.unshift({
      class: "mastercrafted",
      icon: "fas fa-hammer",
      onclick: () => {new RecipeApp(null,null, app.object.name).render(true);}
    });
  }
})

Hooks.on("getHeaderControlsDocumentSheetV2", (app, controls) => {
  if (app.document.documentName === "Item" && ui.RecipeApp._currentApp.getRecipesByIngredient(app.document.name).length) {    
    controls.push({
      label: "mastercrafted.show-recipes",
      icon: "fas fa-hammer",
      onClick: () => {new RecipeApp(null,null, app.document.name).render(true);}
    });
  }
});

Hooks.on("getApplicationHeaderButtons", (app, buttons) => {
  if (app.actor && app.actor.isOwner) {    
    buttons.unshift({
      label: "mastercrafted.craft",
      class: "mastercrafted",
      icon: "fas fa-hammer",
      onclick: () => {new RecipeApp(app.actor).render(true);}
    });
    ui.RecipeApp.processDelayedCrafting([app.actor])
  }
});

Hooks.on("item-piles-preRightClickItem", (item, buttons, actor) => {
  if (ui.RecipeApp._currentApp.getRecipesByIngredient(item.name).length) {    
    buttons.push({
      label: "mastercrafted.show-recipes",
      icon: "fas fa-hammer",
      onPress: () => {new RecipeApp(actor,null, item.name).render(true);}
    });
  }
});