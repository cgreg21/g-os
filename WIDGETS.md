# Systeme de widgets natifs

Le gestionnaire accepte trois formats : **Widget Simple** en JSON, **Flux** avec declarations inspirees de Python et templates YAML/Mustache, et les modules JavaScript GJS. Les widgets fournis par l'extension sont developpes en TypeScript dans `src/widgets` et compiles dans `dist/widgets` ; les paquets JavaScript importes utilisent un fichier `widget.js`. Le HTML, le DOM et WebKit ne sont pas pris en charge.

## Utilisation

- Clic droit sur le bureau : **Configuration des widgets du bureau**.
- Clic droit sur Launchpad dans le Dock : **Gestion des widgets du Dock**.
- Les memes gestionnaires sont accessibles depuis la page **Widgets** des preferences.
- Pour le bureau, choisir l'ecran puis ajouter un widget. La liste des widgets du Dock est commune a tous les ecrans.
- Les instances sont independantes : activation, configuration, verrouillage, position et taille.
- Sur le bureau, la position est exprimee en colonne/ligne et la taille en cases. Le glissement se termine sur la grille.
- Le verrouillage empeche le deplacement accidentel, sans bloquer les boutons du widget.
- **Au premier plan** place l'instance au-dessus des fenetres normales. Les widgets ordinaires restent sur la couche du bureau.
- Le Dock propose les formats Large et 1x1 et un ordre partage entre tous les Docks. Les ecrans deconnectes restent dans le gestionnaire du bureau.
- Une grille visuelle peut etre activee. Les zones de travail tiennent compte de la barre et de l'espace reserve au Dock.

Le premier acces au gestionnaire migre les widgets deja actives vers les instances, avec leurs formats, ecrans et ordre personnalise du Dock. Les positions sont arrondies a la grille. Les anciens interrupteurs deviennent inactifs : les modifications se font ensuite dans le gestionnaire. Les anciens reglages sont conserves pour compatibilite.

Les connecteurs sont utilises comme identifiants d'ecran lorsqu'ils sont exposes par GNOME ; sinon l'identifiant utilise l'index du moniteur.

## Langage Flux

Flux est un langage declaratif propre a cette extension : il separe les sources de donnees du template visuel, sans JavaScript dans le paquet. L'exemple `examples/flux-weather` affiche une temperature obtenue depuis Open-Meteo. Pour l'essayer, importe ce dossier dans le gestionnaire, examine les adresses affichees avant confirmation, puis ajoute **Meteo Flux** au bureau ou au Dock. L'exemple contacte un service externe ; ses coordonnees sont celles de Paris et peuvent etre modifiees dans une copie du paquet.

Un paquet Flux contient trois fichiers. `widget.json` identifie le widget :

```json
{
  "apiVersion": 1,
  "id": "ma-meteo",
  "name": "Ma meteo",
  "language": "flux",
  "entry": "widget.flux",
  "template": "template.flux",
  "icon": "weather-clear-symbolic",
  "targets": ["desktop", "dock"]
}
```

L'identifiant doit etre unique. `icon`, `description`, `preview`, `css`, `size`, `minimum` et `configuration` sont facultatifs. Sans apercu, le catalogue utilise l'icone indiquee ou son icone par defaut. Les champs de configuration sont identiques a ceux des widgets JavaScript.

`widget.flux` definit les sources dans une syntaxe inspiree de Python :

```python
version = 1
interval = 5 * 60
base = "https://api.open-meteo.com"

source(
    "weather",
    url=base + "/v1/forecast?latitude=48.85&longitude=2.35&current=temperature_2m",
    refresh=interval,
    timeout=10,
)
```

La premiere declaration est `version = 1`. Les constantes sont declarees avant leur utilisation et contiennent des chaines simples ou doubles, des nombres et les operations `+`, `-`, `*`, `/` ou des parentheses. Elles sont evaluees uniquement lors du chargement. Les commentaires commencent par `#`. Seul l'appel declaratif `source(...)` est autorise : Flux n'est pas Python et n'execute ni `import`, ni fonctions arbitraires, ni code Python. Les anciens fichiers `widget.flux` au format YAML restent acceptes.

Le nom `weather` est choisi librement : il commence par une minuscule et contient des minuscules, chiffres et tirets. Un widget peut avoir jusqu'a quatre sources. L'URL est determinee par les constantes et commence par `http://` ou `https://`. `refresh` est l'intervalle en secondes, de 60 a 86400, avec 300 par defaut. `timeout` est le delai total en secondes, de 1 a 30, avec 10 par defaut. La premiere requete demarre lorsque l'instance apparait.

`template.flux` definit les vues :

```yaml
version: 1
desktop:
  - type: row
    children:
      - type: icon
        name: weather-clear-symbolic
      - type: text
        style: title
        text: "{{data.weather.current.temperature_2m}} C"
  - type: text
    style: secondary
    text: "Etat : {{status.weather}} {{error.weather}}"
  - type: button
    name: view-refresh-symbolic
    text: Actualiser
    source: weather
dock:
  - type: text
    text: "{{data.weather.current.temperature_2m}} C"
square:
  - type: text
    text: "{{data.weather.current.temperature_2m}}"
```

`desktop` est obligatoire ; `dock` et `square` sont facultatifs et heritent de la vue disponible la plus proche. La vue bureau sert aussi au panneau de detail du Dock. Les boutons sont affiches uniquement dans la vue bureau ou le panneau de detail.

| Type | Champs | Effet |
| --- | --- | --- |
| `text` | `text`, `style` facultatif | Texte natif. `style` vaut `normal`, `title` ou `secondary`. |
| `icon` | `name` | Icone symbolique GNOME. |
| `row`, `column` | `children` | Groupe horizontal ou vertical d'elements. |
| `button` | `name`, `text`, `source` | Bouton d'icone qui relance une source ; `text` est son nom accessible et son infobulle. |
| `repeat` | `items`, `children` | Liste verticale defilable qui cree les composants enfants pour chaque element. |

Les textes et les noms accessibles des boutons acceptent les variables Mustache : `{{data.weather.current.temperature_2m}}`, `{{status.weather}}`, `{{error.weather}}`, `{{config.nom}}` et `{{time}}`. Une valeur absente, un objet ou une liste s'affichent vides ; une liste peut etre parcourue par indice, par exemple `{{data.weather.items.0.name}}`. Entoure les textes contenant des accolades de guillemets YAML.

Les sections Mustache permettent les conditions et les boucles dans un texte :

```yaml
desktop:
  - type: text
    text: "{{#data.weather.items}}{{name}} : {{temperature}} C\n{{/data.weather.items}}{{^data.weather.items}}Aucune donnee{{/data.weather.items}}"
```

`{{#chemin}}...{{/chemin}}` affiche le contenu si la valeur est vraie, ou le repete pour chaque element d'une liste. Dans une boucle, `{{name}}` lit un champ de l'element et `{{.}}` affiche un element simple. Les sections peuvent etre imbriquees ; `{{^chemin}}...{{/chemin}}` s'affiche pour une valeur fausse, absente ou une liste vide. Les commentaires `{{! texte }}` sont ignores. Les variantes `{{valeur}}`, `{{{valeur}}}` et `{{&valeur}}` produisent toutes du texte natif, jamais du HTML. Les partiels, changements de delimiteurs, expressions et appels de fonctions ne sont pas pris en charge.

Pour repeter de vrais composants plutot que du texte, utilise `repeat` :

```yaml
desktop:
  - type: repeat
    items: data.weather.items
    children:
      - type: row
        when: item.visible
        children:
          - type: icon
            name: weather-clear-symbolic
          - type: text
            text: "{{item.name}} : {{item.temperature}} C"
```

`items` designe une liste et `item` represente l'element courant ; dans une repetition imbriquee, il represente l'element de la repetition la plus interieure. Un `when` facultatif contient un chemin tel que `data.weather.current.is_day` ou `item.visible` et affiche l'element si la valeur est vraie. Les listes sont defilables, limitees aux 32 premiers elements et a 128 composants par vue ; les anciens composants sont detruits lors du remplacement des donnees. Les boucles Mustache textuelles sont limitees a 100 elements par section, 4096 operations et 2048 caracteres par texte.

`status.weather` vaut `loading`, `ready` ou `error`. En cas d'erreur, `error.weather` contient un message court et la derniere valeur reussie reste disponible. Les vues d'une meme instance partagent les requetes ; une autre instance possede ses propres sources. Les requetes et timers sont arretes lorsque la derniere vue est detruite. Les donnees HTTP ne sont pas conservees entre sessions.

Chaque source effectue uniquement des requetes GET HTTP(S) et attend du JSON. Les redirections, les identifiants dans l'URL, les en-tetes personnalises, les corps de requete et les variables dans l'URL ne sont pas pris en charge. La reponse est limitee a 256 Kio ; chaque fichier Flux a 64 Kio, les vues a 64 elements au total et quatre niveaux d'imbrication. Les champs inconnus, les sources inexistantes et les references dangereuses sont rejetes. Ne place pas de secret dans une URL : les paquets sont stockes en clair.

**Confiance et reseau** : les requetes peuvent atteindre des services externes ou locaux avec les droits de ta session. L'adresse du service voit l'adresse IP et les parametres envoyes. Le gestionnaire affiche les origines HTTP avant confirmation ; importe uniquement des paquets de confiance. Flux ne lance pas de code du paquet, mais le CSS facultatif est charge dans le theme global et l'extension n'est pas une sandbox.

Pour verifier le moteur et son client HTTP local depuis le dossier source :

```sh
npm run build
node --test --test-name-pattern='Flux language|Flux templates|Flux repeats' tests/extension.test.mjs
gjs -m tests/flux-http-native.js
```

## Widget Simple

Widget Simple permet de creer un widget avec un seul fichier `widget.json`, sans ecrire de JavaScript. Le dossier `examples/simple-counter` contient un exemple pret a importer : selectionne ce dossier dans le gestionnaire, confirme l'import, puis ajoute **Compteur simple** sur le bureau ou dans le Dock.

Pour creer ton propre widget, copie cet exemple dans un nouveau dossier, change son `id` et son `name`, puis adapte les elements :

```json
{
  "apiVersion": 1,
  "id": "mon-compteur-simple",
  "name": "Mon compteur",
  "language": "simple",
  "icon": "view-statistics-symbolic",
  "targets": ["desktop", "dock"],
  "state": {"count": 0},
  "elements": [
    {"type": "text", "text": "Compteur : {{state.count}}"},
    {"type": "button", "text": "Ajouter", "icon": "list-add-symbolic", "action": {"type": "increment", "key": "count", "amount": 1}}
  ],
  "dock": [{"type": "text", "text": "{{state.count}}"}],
  "square": [{"type": "text", "text": "{{state.count}}"}]
}
```

Le JSON est strict : pas de commentaires ni de virgule finale. `id` doit etre unique ; `apiVersion`, `name`, `language`, `targets` et `elements` sont obligatoires. `icon`, `description`, `size`, `minimum`, `configuration`, `state`, `dock`, `square`, `preview` et `css` sont facultatifs. Sans apercu, le catalogue utilise l'icone indiquee ou une icone par defaut. Il ne faut pas fournir `entry` pour ce format.

`elements` decrit la vue bureau et le panneau de detail du Dock. `dock` decrit le resume large et `square` le resume 1x1 ; si ces vues sont absentes, la vue la plus proche disponible est reutilisee. Les boutons ne sont affiches que sur le bureau ou dans le panneau de detail ; un resume sans texte affiche l'icone du widget. Les Docks lateraux utilisent ces memes vues.

| Element | Description |
| --- | --- |
| `text` | Affiche `text`, avec variables optionnelles. |
| `clock` | Affiche l'heure au format du systeme et se met a jour automatiquement. |
| `button` | Affiche une icone ; `text` est son nom accessible et son infobulle. `icon` est facultatif. |

Dans un texte, `{{time}}` affiche l'heure, `{{state.nom}}` la valeur de l'etat et `{{config.nom}}` une valeur de configuration. Une valeur absente est affichee vide. Les champs de configuration utilisent le meme format que les widgets JavaScript : `text`, `switch`, `number`, `select` ou `color`.

Chaque bouton declare une `action` avec une `key` d'etat :

| Action | Exemple | Effet |
| --- | --- | --- |
| `increment` | `{"type":"increment","key":"count","amount":1}` | Ajoute `amount` (1 par defaut) a la valeur numerique, bornee entre -1 milliard et 1 milliard. |
| `toggle` | `{"type":"toggle","key":"active"}` | Inverse la valeur logique. |
| `set` | `{"type":"set","key":"count","value":0}` | Enregistre une chaine, un nombre fini ou un booleen. |

`state` fournit les valeurs initiales. L'etat est conserve par instance : les vues d'une meme instance du Dock le partagent entre ecrans, mais deux instances distinctes restent independantes. La configuration se modifie depuis le gestionnaire. Les connexions a l'heure et a l'etat sont nettoyees automatiquement lorsque la vue disparait.

Chaque vue accepte de 1 a 16 elements et l'etat initial jusqu'a 32 valeurs. Les cles commencent par une minuscule et contiennent uniquement des minuscules, chiffres et tirets ; `constructor` et `prototype` sont reserves. Les textes et les chaines d'etat sont limites a 512 caracteres. `amount` doit etre fini et compris entre -10000 et 10000. Widget Simple ne fournit pas de requetes reseau : utilise Flux pour les donnees HTTP JSON ou le format JavaScript pour une logique personnalisee. Un CSS ou un apercu facultatif doit etre fourni dans le dossier du paquet ; le CSS reste charge dans le theme global et l'import n'est pas une sandbox.

## Creer un widget JavaScript complet

Ce tutoriel cree un compteur configurable, utilisable sur le bureau et dans le Dock. Le bouton du bureau augmente le compteur ; son etat est conserve entre les sessions. Le Dock affiche un resume et ouvre le panneau de detail au clic.

### 1. Preparer le dossier

Depuis la racine du dossier source de l'extension, copie l'exemple fourni pour reutiliser son apercu SVG :

```sh
mkdir -p "$HOME/widgets"
test ! -e "$HOME/widgets/mon-compteur" && cp -r examples/example-status "$HOME/widgets/mon-compteur"
```

Le dossier de travail contient `widget.json`, `widget.js`, `widget.css` et `preview.svg`. Il est distinct de la copie installee par le gestionnaire. Si la destination existe deja, la copie n'est pas effectuee : choisis un autre nom et un identifiant correspondant.

### 2. Decrire le widget

Dans `~/widgets/mon-compteur/widget.json`, utilise ce descriptif complet :

```json
{
  "apiVersion": 1,
  "id": "mon-compteur",
  "name": "Mon compteur",
  "description": "Un compteur avec un pas configurable.",
  "entry": "widget.js",
  "preview": "preview.svg",
  "css": "widget.css",
  "targets": ["desktop", "dock"],
  "size": {"columns": 7, "rows": 4},
  "minimum": {"width": 120, "height": 96},
  "configuration": [
    {"key": "title", "title": "Titre", "type": "text", "default": "Compteur"},
    {"key": "step", "title": "Pas", "type": "number", "min": 1, "max": 100, "step": 1, "default": 1}
  ]
}
```

L'identifiant doit etre unique, commencer par une lettre minuscule et ne contenir que des minuscules, chiffres et tirets. Le dossier installe est nomme d'apres cet identifiant. `targets` indique les surfaces autorisees. `size` donne la taille initiale en cases sur le bureau ; `minimum` fixe la taille minimale en pixels. Les champs de `configuration` produisent automatiquement les controles du gestionnaire.

### 3. Implementer le widget

Dans `~/widgets/mon-compteur/widget.js`, remplace le contenu par :

```js
export function create(context) {
    const {api, config, target, square} = context;
    const view = api.card(config.title || 'Compteur', 'view-statistics-symbolic');
    view.actor.add_style_class_name('mon-compteur');

    const value = api.label('', {
        style_class: target === 'dock' ? 'mon-compteur-dock-value' : 'mon-compteur-value',
    });
    view.body.add_child(value);

    const render = (state = api.getState()) => {
        const count = Number.isFinite(state.count) ? state.count : 0;
        value.text = String(count);
    };

    if (target === 'desktop') {
        const increment = api.button('list-add-symbolic', 'Augmenter le compteur', () => {
            const state = api.getState();
            const count = Number.isFinite(state.count) ? state.count : 0;
            api.saveState({count: count + config.step});
        });
        view.body.add_child(increment);
    } else if (square) {
        view.actor.add_style_class_name('mon-compteur-square');
    }

    api.watchState(render);
    render();
    return {...view, update: render};
}
```

`create` est appelee pour chaque vue et doit retourner immediatement un acteur. `api.card` fournit l'acteur, son corps et une poignee de deplacement pour le bureau. Le bouton n'est ajoute que dans la vue bureau ; pour une instance du Dock, cette vue est aussi utilisee dans son panneau de detail. `api.watchState` met a jour les vues qui partagent la meme instance, et sa connexion est nettoyee automatiquement.

La configuration (`title`, `step`) est propre a chaque instance et modifiable dans le gestionnaire. L'etat (`count`) est egalement propre a chaque instance, mais se modifie avec `api.saveState` sans reconstruire le widget. Une instance de bureau et une instance du Dock ajoutees separement possedent chacune leur propre compteur ; les copies d'une meme instance du Dock sur plusieurs ecrans partagent leur compteur.

### 4. Ajouter le style

Dans `~/widgets/mon-compteur/widget.css`, remplace le style de l'exemple :

```css
.mon-compteur .mon-compteur-value {
  font-size: 24px;
  font-weight: bold;
}

.mon-compteur .mon-compteur-dock-value {
  font-size: 14px;
  font-weight: bold;
}

.mon-compteur-square .mon-compteur-dock-value {
  font-size: 12px;
}
```

Le style est charge dans le theme de GNOME Shell. Utilise des classes propres au widget et les proprietes CSS prises en charge par St ; il ne s'agit pas d'une page Web. L'apercu `preview.svg` copie a l'etape 1 peut etre remplace par un fichier PNG ou SVG regulier, en adaptant `preview` si necessaire.

### 5. Verifier et importer

Verifie la syntaxe depuis le dossier de travail :

```sh
cd "$HOME/widgets/mon-compteur"
node -e 'JSON.parse(require("fs").readFileSync("widget.json", "utf8")); console.log("JSON valide")'
node --input-type=module --check < widget.js
```

Ces commandes necessitent Node.js et ne verifient ni les API GJS ni le rendu. Dans GNOME, ouvre le gestionnaire des widgets depuis les preferences ou le menu du bureau, choisis **Importer un dossier de widget**, selectionne `~/widgets/mon-compteur`, puis confirme. Ajoute **Mon compteur** depuis le catalogue et verifie :

1. Sur le bureau, le bouton augmente le compteur selon le pas choisi ; le widget se deplace et se verrouille depuis le gestionnaire.
2. Dans le Dock, le resume, le panneau au clic, les formats Large et 1x1, ainsi que les positions basse et laterales restent lisibles.
3. La configuration et l'etat survivent a une reconnexion ; plusieurs instances restent independantes, tandis qu'une instance du Dock apparait sur tous les ecrans.
4. Les themes clair et sombre, le changement de taille, la suppression d'une instance et la section **Erreurs** du gestionnaire se comportent correctement.

Le gestionnaire copie le paquet dans les donnees utilisateur : modifier le dossier de travail ne modifie pas cette copie. L'import refuse un identifiant deja installe. Pour tester une nouvelle version, utilise un nouvel identifiant ou desinstalle l'ancienne version, reimporte le dossier et redemarre la session. La desinstallation retire aussi ses instances et leur etat. Redemarrer la session est necessaire pour eviter le cache des modules GJS, y compris apres une modification manuelle de la copie installee.

### 6. Cycle de vie et operations asynchrones

Utilise `api.connect`, `api.watchClock`, `api.watchState` et `api.every` pour que les connexions et timers soient liberes automatiquement. `api.onCleanup` et le champ facultatif `destroy` servent aux autres ressources ; ne detruis pas l'acteur dans `destroy`, le moteur s'en charge. Une modification de configuration peut reconstruire la vue : ne conserve pas de reference globale vers ses acteurs.

Pour une lecture asynchrone, protege la mise a jour de l'interface apres destruction et traite les erreurs :

```js
let alive = true;
api.onCleanup(() => { alive = false; });

async function refresh() {
    try {
        const stats = await api.systemStats();
        if (alive)
            value.text = api.formatBytes(stats.memoryUsed);
    } catch (error) {
        if (alive)
            value.text = 'Donnees indisponibles';
    }
}

refresh();
```

Cet extrait suppose que `api` et `value` ont ete crees dans `create`. Evite les traitements bloquants et, pour un rafraichissement periodique, empeche les lectures simultanees si une operation peut depasser l'intervalle. Les lectures lancees par les helpers de l'API sont annulees a la destruction, mais une promesse rejetee doit toujours etre traitee.

### Depannage

- **Le paquet ne s'importe pas** : controle le JSON, l'unicite de `id`, la presence de `widget.js` et de l'apercu, ainsi que l'absence de liens symboliques dans le dossier. Les chemins doivent rester relatifs au paquet.
- **Le widget apparait dans Erreurs** : lis le message du gestionnaire ; une erreur de creation ou d'un callback gere par `api.connect`, `api.watchState`, `api.watchClock` ou `api.every` y est signalee.
- **Un clic ou une lecture asynchrone echoue** : traite explicitement les erreurs des promesses et consulte le journal de GNOME Shell, par exemple avec `journalctl --user -f -o cat /usr/bin/gnome-shell`.
- **Les modifications ne s'affichent pas** : verifie la copie installee et redemarre la session apres modification ou reimportation, car GJS conserve les modules charges.
- **Le contenu deborde** : augmente la taille minimale ou simplifie la vue du Dock, en particulier en format 1x1 et sur les bords lateraux.

## Format du paquet JavaScript

```text
mon-widget/
  widget.json
  preview.png
  widget.js
  widget.css
  assets/
```

`widget.json`, le fichier d'apercu et `widget.js` sont obligatoires. Le CSS et les ressources supplementaires sont optionnels. Les apercus fournis peuvent aussi utiliser SVG.

```json
{
  "apiVersion": 1,
  "id": "mon-widget",
  "name": "Mon widget",
  "description": "Description courte",
  "entry": "widget.js",
  "preview": "preview.png",
  "css": "widget.css",
  "targets": ["desktop", "dock"],
  "size": {"columns": 7, "rows": 4},
  "minimum": {"width": 120, "height": 96},
  "configuration": [
    {"key": "title", "title": "Titre", "type": "text", "default": "Bonjour"},
    {"key": "enabled", "title": "Afficher le texte", "type": "switch", "default": true},
    {"key": "font-size", "title": "Taille du texte", "type": "number", "min": 8, "max": 24, "step": 1, "default": 12},
    {"key": "mode", "title": "Mode", "type": "select", "choices": ["A", "B"], "default": "A"},
    {"key": "color", "title": "Couleur", "type": "color", "default": "#f5f6f8"}
  ]
}
```

L'identifiant commence par une lettre minuscule et utilise ensuite lettres minuscules, chiffres et tirets. Le dossier installe porte cet identifiant. `apiVersion` doit valoir `1`. Les chemins de ressources sont relatifs au dossier et ne peuvent pas contenir `..` ou un chemin absolu.

La configuration est une liste de champs `switch`, `number`, `text`, `select` ou `color`. Le gestionnaire genere les controles correspondants et sauvegarde les valeurs par instance. Les nombres sont bornes ; les selections et couleurs sont validees. La taille minimale est exprimee en pixels et preserve la lisibilite avec une grille fine.

## Point d'entree JavaScript

```js
export function create(context) {
    const {api, config} = context;
    const actor = api.box({vertical: true, style_class: 'mon-widget'});
    if (context.target === 'dock' && context.square) {
        actor.add_child(api.icon('appointment-soon-symbolic', context.iconSize));
        return {actor};
    }
    const label = api.label(config.title, {visible: config.enabled});
    actor.add_child(label);
    return {actor, dragHandle: label};
}
```

`create(context)` est synchrone et retourne `{actor, dragHandle?, update?, destroy?}`. Il est possible de lancer des lectures asynchrones apres creation et de mettre a jour l'acteur. `destroy` sert au nettoyage des ressources supplementaires : ne pas y detruire a nouveau l'acteur.

Le contexte fournit :

| Champ | Usage |
| --- | --- |
| `target` | `desktop` ou `dock` |
| `instance` | Identifiant, ecran, placement, verrouillage et configuration persistante |
| `config` | Valeurs validees suivant `configuration` |
| `monitor` | Geometrie du moniteur |
| `screen` | Contexte du Dock, lorsqu'il s'agit du Dock |
| `iconSize`, `iconPadding` | Dimensions courantes du Dock |
| `square` | Format 1x1 du Dock |
| `orientation` | Enumerations d'orientation Clutter |

API disponible :

| Fonction | Usage |
| --- | --- |
| `api.box(properties)` | Conteneur St.BoxLayout |
| `api.label(text, properties)` | Libelle avec ellipsisation |
| `api.icon(name, size)` | Icone native |
| `api.button(icon, title, callback)` | Bouton natif avec nom accessible |
| `api.entry(hint, text, properties)` | Saisie native, option `multiline` pour une note |
| `api.card(title, icon)` | Bloc utilitaire avec `actor`, `body` et zone de deplacement |
| `api.asset(relativePath)` | URI d'une ressource du paquet |
| `api.fileIcon(uri)` | Gio.FileIcon |
| `api.now()` | GLib.DateTime local |
| `api.clockText()` | Horloge formatee par GNOME |
| `api.clockTimeText()` | Heure seule, dans le format systeme |
| `api.watchClock(callback)` | Mise a jour horloge, deconnectee automatiquement |
| `api.connect(object, signal, callback)` | Connexion avec nettoyage automatique |
| `api.every(milliseconds, callback)` | Timer, minimum 100 ms, annule a la destruction |
| `api.onCleanup(callback)` | Nettoyage supplementaire |
| `api.saveConfig(changes)` | Persistance de la configuration d'une instance geree |
| `api.getState()` | Etat persistant de l'instance |
| `api.saveState(changes)` | Fusion des changements d'etat sans reconstruire le widget |
| `api.watchState(callback)` | Mise a jour sur changement de l'etat |
| `api.wallTime()` | Temps Unix en millisecondes |
| `api.formatDuration(milliseconds)` | Format de duree lisible |
| `api.formatBytes(bytes)` | Format de taille en Kio/Mio/Gio |
| `api.systemStats()` | Promise : compteurs CPU, memoire, charge et uptime Linux |
| `api.diskStats(path)` | Promise : espace total/libre, `~` est accepte |
| `api.solve(expression)` | Promise : resultat du moteur GNOME Calculatrice |
| `api.notify(title, message)` | Notification GNOME |
| `api.openConfiguration()` | Ouvre le gestionnaire pour l'ecran et la surface |
| `api.mediaState()` | Lecteur MPRIS choisi, titre, artiste, pochette et capacites |
| `api.mediaAction(action)` | `playPause`, `previous`, `next`, `raise` |
| `api.createMediaView(properties)` | Vue native du lecteur media |
| `api.createDockBuiltin(type, context)` | Adaptateur Dock des widgets fournis : clock/calendar/media |

Les erreurs de creation et des callbacks enveloppes par `api.connect`, `api.watchState`, `api.watchClock` et `api.every` sont publiees dans le gestionnaire. Les callbacks de bouton et les promesses demandent leur propre gestion d'erreur. Tous les acteurs doivent rester dans leur bloc ; les formats Dock sont cadres et les formats lateraux adaptes. Un widget peut choisir un rendu specifique suivant `target`, `square` et `screen.position`.

## CSS

Le CSS utilise les proprietes supportees par St, pas le CSS complet d'un navigateur. Employer des classes propres au widget et eviter les selecteurs globaux : le stylesheet est charge dans le theme GNOME Shell.

```css
.mon-widget {
  spacing: 4px;
  padding: 8px;
  border-radius: 8px;
}
```

## Import et confiance

L'import selectionne un **dossier**, puis demande confirmation. Le code des widgets JavaScript peut s'executer des le chargement du catalogue et dispose des droits de l'utilisateur dans le processus GNOME Shell. Flux peut effectuer des requetes HTTP vers les origines indiquees avant confirmation. Flux et Widget Simple n'executent pas de JavaScript du paquet, mais leur CSS facultatif est charge dans le theme global. L'import n'est pas une sandbox : importer uniquement des paquets de confiance.

Les paquets sont copies dans `$XDG_DATA_HOME/g-os/widgets/` (habituellement `~/.local/share/g-os/widgets/`). Les liens symboliques, les fichiers speciaux, les ressources hors du paquet et les identifiants deja installes sont refuses. Limites : 32 Mio, 512 ressources, descriptif de 1 Mio et 128 champs de configuration.

Un paquet importe peut etre desinstalle depuis le catalogue, avec confirmation ; ses instances sont retirees. Les paquets fournis par l'extension ne sont pas supprimables par cette action.

Les modules ES JavaScript sont caches par GJS. Pour une nouvelle version, choisir un nouvel identifiant, ou relancer la session apres une modification manuelle. La revision du catalogue decouvre les nouveaux paquets, mais ne remplace pas un module JavaScript deja importe. Les fichiers Flux sont relus lors d'une revision du catalogue ; la copie importee reste distincte du dossier source. Desinstaller un paquet retire ses instances et leur etat.

## Widgets fournis et exemple

- `widgets/clock` : Horloge, configuration du format et de la date.
- `widgets/calendar` : Calendrier, configuration du jour de la semaine.
- `widgets/media` : lecteur MPRIS, bureau et Dock, selection du lecteur et capacites de transport.
- `widgets/notes` : note modifiable et persistante, avec titre configurable.
- `widgets/tasks` : liste de 32 taches maximum, completion, suppression et pagination.
- `widgets/calculator` : expressions avec le moteur GNOME Calculatrice, sans evaluation JavaScript.
- `widgets/timer` : compte a rebours de 1 a 240 minutes, pause, reprise et notification optionnelle.
- `widgets/stopwatch` : chronometre persistant avec cinq derniers tours.
- `widgets/world-clock` : heure et date d'un fuseau IANA, format 12/24 heures.
- `widgets/system-monitor` : CPU, RAM, charge et uptime, lus de facon asynchrone dans `/proc`.
- `widgets/storage` : espace libre et utilise du disque contenant un dossier, rafraichissement configurable.
- `examples/example-status` : paquet importable couvrant les cinq types de champs, le CSS, l'horloge et les formats Dock.

Les huit widgets utilitaires affichent un resume dans le Dock ; un clic ouvre leur panneau de detail. Ils prennent aussi en charge le format 1x1 et les Docks lateraux. Leur etat est conserve par instance dans `widget-state`, independamment de la configuration ; retirer une instance dans le gestionnaire retire aussi son etat. Les operations asynchrones sont annulees a la destruction. La calculatrice requiert `gnome-calculator` et affiche une erreur si le moteur n'est pas disponible. Les minuteurs utilisent le temps systeme pour continuer apres une reconnexion.

Le media reutilise la source MPRIS de GNOME Shell 50. Ses commandes se desactivent si aucun lecteur compatible n'est disponible. Sur un Dock lateral, le lecteur empile pochette et commandes ; le titre reste disponible dans son panneau et son libelle accessible.