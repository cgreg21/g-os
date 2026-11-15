# Rapport exploratoire G-Os - 2026-11-09

## Deploiement complet - 2026-11-10

Le build TypeScript et ressources passe, ainsi que **62/62 tests unitaires**.
Le test GNOME `reachability` passe **9/9 configurations** apres correction de
la mise a jour live de la magnification : la position du pointeur est capturee
avant le recalcul geometrique et restauree avant de reprogrammer l'animation.

La distribution `dist` a ete synchronisee integralement vers
`~/.local/share/gnome-shell/extensions/g-os@greg.local` (**129 fichiers**),
puis comparee fichier par fichier. L'installation precedente est sauvegardee
dans `~/.local/state/g-os/backups/deploy-20261110T1525/`. L'extension a ete
desactivee puis reactivee pour charger le build ; `gnome-extensions info`
confirme l'etat `ACTIVE`. Aucun reglage GSettings n'a ete modifie.

Limite visuelle toujours ouverte : le rapport de campagne constate des portions
d'icones rognees a 400 % aux limites de la vue defilante. Le controle
`reachability` valide le picking et les dimensions, mais ne certifie pas
l'absence de rognage visuel sur toute la surface peinte ; ce deploiement ne
declare donc pas cet aspect resolu.

## Nouvelle baseline - erreur de demarrage (2026-11-09)

Au moment de cette baseline du 9 novembre, `gnome-extensions info g-os@greg.local`
indiquait l'etat `ERROR`. Le journal utilisateur GNOME du 9 novembre a 18:40 et
18:50 confirmait des erreurs repetees `TypeError: MetaLater.later_add is not a function` dans
`_queueDockIconGeometry` (`src/extension.ts`) et `_queueDockMagnification`
(`src/dock/dockAppearance.ts`). Ces appels sont utilises lors de la mise a jour
de la geometrie du Dock et de la magnification; l'extension ne peut donc pas
assurer correctement ces parcours tant que le demarrage reste en erreur.

La relance de `npm test` construit le projet, puis rapporte **44/167 tests passes
et 123 echoues**. Les 123 echecs ont la meme cause immediate:
`Cannot read properties of undefined (reading 'BEFORE_REDRAW')` dans
`_queueDockIconGeometry`. Le harnais ne fournit pas l'API `Meta.LaterType`
attendue. Ces echecs en cascade ne sont pas 123 defauts fonctionnels distincts
et ne permettent pas de valider les parcours couverts par ces tests. Ils
constituent neanmoins un defaut du harnais a corriger avant d'utiliser cette
suite comme signal de regression.

Conclusion de l'exploration actuelle : **P1, incompatibilite de l'API de
planification Meta** affectant le demarrage et les mises a jour du Dock; et
**P1, harnais unitaire invalide** pour les parcours qui construisent le Dock.
Les anciens bilans 163/163 et les parcours natifs verts restent des resultats
historiques, pas une preuve du fonctionnement de l'installation actuelle.
Cette mise a jour ne change aucun module runtime ni reglage utilisateur.

## Verification TypeScript et parcours finaux

Le contrôle de compatibilité couvre maintenant tout `src/**/*.ts`. Les contrats
des acteurs bureau/Dock, les flux GIO et les vues GTK sont annotés ; les valeurs
d’erreur `unknown` passent par un helper commun. `npm run build` émet désormais
sans `--noCheck`. **163/163 tests unitaires** et les deux configurations de
typecheck passent. Les valeurs null restent permissives dans la configuration
générale, les types GJS ciblent GNOME 51, et Soup reste une déclaration ambiante
minimale faute de paquet GIR installé.

Parcours natifs finaux sous GNOME Shell 51.1 : interactions du bureau, widgets,
média, huit menus de panneau, calendrier et raccourcis passent. Le scénario
widgets a aussi passé trois exécutions consécutives. Son ancien contrôle comparait
les widgets à l’origine du workarea alors que la grille visible commence sous la
barre overlayée ; il compare maintenant les coordonnées widget/grille dans le
même repère. Cela corrige le banc, pas un changement du placement runtime.

Déploiement : douze modules runtime et leurs source maps, helper partagé inclus,
comparés à `dist`. Sauvegarde :
`~/.local/state/g-os/backups/typecheck-migration-yTVmDI/`. Aucun thème, schéma ou
réglage utilisateur n’a été modifié. Une reconnexion reste nécessaire pour que
la session GNOME charge les nouveaux modules ESM.

## Correctifs de la derniere campagne

Preuves : `/home/greg/Documents/.g-os-test-output/audit-fixes-b9GJCT/`.
Build et deux typechecks passent, ainsi que **163/163 tests unitaires**.

- Grille : suppression du bouclage des emplacements, zone `St.Viewport`
  defilante par ecran et placement dans la zone de travail. La derniere icone
  reste accessible par defilement quand la grille depasse l'ecran.
- Libelles : hauteur de ligne mesuree sur le contenu natif apres application du
  style. Plus de depassement dans les cellules de 64 pixels testees.
- Alignement a droite : marge exacte de 24 pixels, sans arrondi sur la grille
  d'origine gauche. **81 configurations par theme, 162 au total, sans anomalie**.
- Clic droit du fond : un nouveau test au pointeur a revele l'interception par
  la zone defilante ; le clic est maintenant transmis au menu natif. Selection
  simple/Ctrl/rectangle, double-clic, menus, copie recursive, couper/coller,
  creation, renommage et placement libre passent les tests natifs.
- Recherche : les raccourcis GNOME occupes sont detectes. Le secours temporaire
  Ctrl+Alt+Espace, puis Ctrl+Super+Espace, utilise un backend memoire. Aucun
  raccourci de langue ni choix utilisateur n'est ecrase. Ouverture, saisie et
  desactivation testees avec le conflit Super+Espace toujours present.
- Piles : ecart calcule sur les positions reelles, **12 pixels logiques dans
  les deux themes**, avec les libelles toujours a 8 pixels des icones.
- Reglages : conservation des panneaux pour les mises a jour compatibles,
  changement du conteneur de grossissement sans reconstruction de la topbar,
  lecture dynamique des durees/forces de survol et autres delais. Les changements
  structurels non compatibles gardent le chemin de reconstruction complet.

Comparaison native en serie, meme protocole et ancienne extension figee :

| Mesure | Avant, sombre | Apres, sombre | Apres, clair |
| --- | ---: | ---: | ---: |
| Application de 24 rafales, mediane | 58,393 ms | 52,323 ms | 54,364 ms |
| P95 de ces applications | 98,223 ms | 85,629 ms | 88,942 ms |
| Panneaux conserves | 0/24 | 13/24 | 13/24 |
| Duree/force de survol, mediane sur 12 rafales | 56,038 ms | 8,067 ms | 7,720 ms |
| Icones conservees sur ces 12 rafales | 0/12 | 12/12 | 12/12 |

Le gain sur les curseurs est net, pas une garantie d'absence de saccades :
le maximum des rafales structurelles reste de 143,628 ms en sombre et
133,941 ms en clair. Ce ne sont pas des mesures de FPS sur GPU reel.

Regressions natives : 48 configurations finales et six cycles disable/enable,
24 cas de transitions, 12 configurations de grossissement/36 points sans
anomalie, apercus de fenetres sur trois bords, calendrier, huit menus systeme
et parcours widgets passent. Captures de grille et de piles inspectees.
Les limites materielles de l'audit initial restent applicables : pas de
validation physique multi-ecran, USB, HiDPI/VRR ou charge GPU reelle.

Deploiement : six modules runtime et leurs source maps installes et compares
octet par octet a `dist` (extension, panel, desktopIcons, desktopIconLayout,
dockAppearance, dockFolders). Sauvegarde :
`~/.local/state/g-os/backups/exploratory-fixes-rFn5Jk/`.
Themes, schemas et reglages utilisateur inchanges. Une deconnexion/reconnexion
est necessaire pour charger les nouveaux modules ESM dans la session courante.

## Nouvelle campagne - extension installee, apres les interactions du bureau

Cette campagne est un audit, pas un deploiement de correctifs. Seuls ce rapport
et le harnais `tests/gnome-visual.js` ont ete modifies. Aucun module runtime,
theme installe ni reglage de la session utilisateur n'a ete change.

Baseline : GNOME Shell 51.1, ecran virtuel 1280 x 720, themes installes G-Os et
G-Os-Dark. Paquet construit depuis l'extension installee, SHA-256 :
`736642f69f59325daf969c372001f72ce79e3eff0659046688d1a26623ff9141`.
Build/typechecks et **161/161 tests unitaires** passent.

Preuves de cette campagne :
`/home/greg/Documents/.g-os-test-output/exploratory-current-ld0rZY/`.
`results.tsv` recense **71 executions : 70 sessions Shell et un parcours GTK**.
65 executions sortent avec le code 0, six avec un echec. Un code 0 ne signifie
pas absence de defaut : les audits de grille, recherche et transitions ecrivent
aussi leurs observations dans leurs propres JSON.

### P1 - Superposition des icones quand la grille du bureau est pleine

Reproduit sur les acteurs natifs, dans les deux themes, avec 20 icones.
Cellule 256 px, libelle lateral : quatre emplacements seulement sont distincts,
les 16 icones suivantes reprennent les memes coordonnees. Avec le libelle en bas,
12 des 20 icones partagent un emplacement deja utilise. Le probleme commence
aussi a la capacite de grilles plus petites : 36 icones pour des cellules de
96 px et des libelles lateraux, dans cet ecran de test.

Cause locale : `desktopIconGridPosition` utilise un modulo sur le nombre de
colonnes, puis contraint toutes les lignes aux bornes de l'ecran. Aucun traitement
du debordement de capacite n'est prevu. Les noms se superposent et certains
elements deviennent difficilement selectionnables individuellement.

Reference : `src/desktop/desktopIconLayout.ts`, calcul de `column`.
Preuves : `extended-dark/desktop-layout-audit/desktop-layout-audit.json`,
`desktop-grid-overlapping-icons.png`, memes resultats dans `extended-light/`.
27 configurations sur 81 presentent des collisions dans chaque theme.

### P2 - Libelles sous les icones en dehors de leur cellule

Reproduit dans les deux themes pour neuf configurations sur 81.
Exemple : grille 64 px, icone 48 px, libelle dessous. Le bouton commence a
`y=48`, finit a `112`, mais le label occupe `y=104..123` : depassement de 11 px.
La hauteur de cellule est calculee avec `iconSize + 16`, sans mesurer la hauteur
du texte, l'espacement et le padding du contenu.

Reference : `src/desktop/desktopIcons.ts`, `_createDesktopIcon`.
Preuve : `extended-dark/desktop-layout-audit/desktop-content-overflow-64-48.png`
et champ `overflowingChildren` du JSON de grille. Le controle porte sur les
acteurs enfants reels, pas uniquement sur les dimensions du bouton.

### P2 - Alignement automatique a droite avec marge variable

Reproduit dans les deux themes pour 15 configurations sur 81.
Marge attendue selon le placement initial : 24 px. Mesuree : 40 px avec une
cellule de 64 px, et 232 px avec une cellule de 256 px. La position calculee
depuis la droite est ensuite bornee par `maxX`, derive d'une grille depuis la
gauche. Les deux origines ne coincident pas pour ces tailles.

Reference : `src/desktop/desktopIconLayout.ts`, calcul de `maxX` et borne de `x`.
Preuves : champs `marginRight` et `right-alignment-inconsistent-margin` du JSON,
capture `extended-dark/desktop-layout-audit/desktop-grid-right-margin.png`.
Sur l'ensemble des trois categories de defauts de grille, **41/81 configurations
par theme** ont au moins une observation ; les comptes se recoupent.

### P2 - Conflit de configuration confirme sur Super+Espace

Le raccourci de recherche est enregistre mais n'ouvre pas une recherche utilisable
dans plusieurs passages lorsque GNOME utilise aussi Super+Espace pour changer
de source de saisie. Ctrl+Alt+Espace fonctionne dans ces memes sessions.
Contre-test dans les reglages temporaires uniquement : vider
`org.gnome.desktop.wm.keybindings switch-input-source` rend Super+Espace et la
saisie fonctionnels. Il s'agit d'un conflit de raccourcis, deja signale dans
les preferences, pas d'une panne generale de la recherche.

Preuves : `serial-dark/search-conflict-0/search-shortcuts.json` et
`serial-dark/search-conflict-1/search-shortcuts.json`.

### Fluidite - reconstructions couteuses et quelques longues frames

Mesures effectuees sequentiellement, sans autre scenario GNOME concurrent :

| Mesure (24 configurations par theme) | Sombre | Clair |
| --- | ---: | ---: |
| Setters synchrones, mediane | 3.971 ms | 4.363 ms |
| Setters synchrones, P95 | 12.977 ms | 19.137 ms |
| Reconstruction differee, mediane | 59.280 ms | 58.118 ms |
| Reconstruction differee, P95 | 93.914 ms | 90.784 ms |
| Reconstruction differee, maximum | 133.781 ms | 131.257 ms |

Ces reconstructions sur le thread principal constituent un risque de saccade
au changement de taille, position et options ; ce ne sont pas des mesures de
FPS soutenu. Les 48 etats finaux et six cycles desactivation/reactivation passent.
Preuves : `serial-{dark,light}/state-stress/state-stress.json`.

Audit supplementaire de survol : 24 configurations par theme (modes 0/1/2/3,
trois bords, durees 80/400 ms), dont un echantillon invalide par theme parce que
son acteur a ete remplace. Tous les 18 cas animes valides de chaque theme ont
une transition d'entree et de sortie, un effet visible et un retour au repos.
Pas de transition manquante confirmee dans ces cas. P95 maximal par cas anime :
20.146 ms en sombre, 18.911 ms en clair. Pointe isolee entre deux frames :
147.454 ms en sombre, 45.184 ms en clair ; a confirmer sur GPU/session reels,
sans conclure a une saccade permanente.
Preuves : `serial-dark/motion-final/dock-motion-audit.json` et
`final/motion-light/dock-motion-audit.json`.

### P3 - Ecart de pile different entre themes

La derniere icone de pile est a 18 px du Dock en clair, contre 14 px en sombre.
L'ecart clair depasse le contrat actuel du test (maximum 16 px), sans chevauchement.
Reproduit trois fois en clair et plusieurs fois en sombre : ecart de style mineur,
pas un blocage de l'ouverture. Alignement icones/labels et ecart texte/icone 8 px
corrects dans les cas mesures.
Preuves : `extended-light/stacks/stack-gap.json`, `stack-gap-out-of-range.png`,
journal `extended-dark/stacks/native.log`.

### Couverture fonctionnelle et contre-tests

| Domaine | Resultat de cette campagne |
| --- | --- |
| Widgets simples, Flux/HTTP local, huit utilitaires | Parcours passes, deux themes |
| Widgets geres | Import/retrait, configuration, grille, verrouillage, premier plan et glisser-deposer passes |
| Media/MPRIS simule | Commandes, lecteur absent, formats bureau/Dock/carre/lateral passes |
| Dock widgets | 108 controles de contenance, plus vrai reordonnancement et menu de format dans les deux themes |
| Marges et maximisation | 36 configurations, 72 maximisations premier/deuxieme cycle identiques |
| Dock couvert | Deplacement, minimisation, fermeture, revelation au bord passes |
| Notifications | 18 positions mesurees (9 par theme), liste, effacement et cloche vide passes |
| Calendrier personnalise | Ouverture reelle, evenement/date, absence de notifications et restauration passes |
| Bureau fichiers | Tailles, libelles, Home, fichier temporaire, double-clic/Ctrl/rectangle, menus, copie, creation et renommage passes |
| Barre et menus systeme | 16 popups, bornes ecran et restauration passes ; aucun flux audio reel disponible |
| Cover Flow | Rendu, format compact, Alt/Shift+Tab, activation, Echap, fermeture et restauration passes apres attente correcte du reglage differe |
| Apercus de fenetres | Delai, annulation, clones, passage du pointeur et activation passes sur trois bords/deux themes |
| App Grid | Favoris visibles, tri et depot vers Dock passes |
| Menu global | Fixtures GTK/DBusMenu et dix menus Inkscape passes |
| Overview | Reservation du Dock retiree et restauree sans mouvement du Dock |
| Preferences GTK | Parcours complet natif passe, dont controles du bureau et gestionnaire de widgets |

Magnification : 24 configurations distinctes dans les deux themes, 72 points de
survol/clic. Le premier passage sombre lisait un acteur remplace ; ce cas a ete
refait seul apres stabilisation et passe. Le passage clair complet est vert.
Retour au repos, masquage/revelation, zone cliquable et contenance de l'icone
survolee passent dans les reprises exploitables. P95 par configuration du passage
clair : 17.095..19.250 ms ; maximum ponctuel 20.432 ms.

Les erreurs initiales Cover Flow de restauration des raccourcis provenaient
d'une assertion avant l'application differee des reglages. Inkscape necessitait
`--extra-filter=Inkscape` plutot que `Gjs` : le parcours corrige passe.
Des messages d'objets detruits sont presents au demarrage de certaines sessions
dans les API natives de calendrier et a l'arret du Shell (notamment Flux/App Grid).
Ils ne sont pas presentes comme des crashes produit reproductibles en utilisation.
Les anciennes captures d'acteurs detruits du harnais ne sont pas utilisees comme
preuve de bug de ciblage. Le lanceur peut ecraser le JSON `--perf-output` ; les
mesures detaillees utilisees ici sont dans des fichiers distincts.

### Limites de cette campagne

- Ecran virtuel unique ; pas de validation physique multi-moniteur, HiDPI/VRR,
  GPU charge, verrouillage, veille/reprise ni changement de session utilisateur.
- Pas d'ejection USB physique, connexion a un partage distant, corbeille de
  documents personnels ni changement du volume/audio reel.
- Les profils GNOME/GTK sont temporaires. Les operations de fichiers portent
  sur des fixtures du banc, nettoyees a la fin ; les icones d'audit de grille
  sont des acteurs synthetiques et ne creent pas 20 documents personnels.
- Des transitions ont ete effectivement observees, mais cet audit n'est ni
  une preuve d'exhaustivite ni une garantie de fluidite sur toute machine.

## Historique des campagnes precedentes

## Corrections de la campagne elargie

Les trois defauts exposes ci-dessous ont ete traites et les modules corriges
ont ete synchronises dans l'installation locale apres validation.

- Les changements de reglages regroupent une seule reconstruction en idle;
  afficher/masquer le titre actif et la cloche ne reconstruit plus le panneau.
- Les neuf positions de notification sont implementees par une enveloppe alignee
  autour du conteneur GNOME original, sans modifier ses animations internes.
  La desactivation restaure explicitement le parent et l'acteur natifs.
- Une cloche sur chaque panneau ouvre la liste des notifications, avec activation,
  effacement, etat vide et defilement. Pas de compteur global ajoute; les badges
  par application restent independants. La visibilite suit le commutateur des preferences.

Validation : build et verifications TypeScript du projet passes, **155/155 tests**.
Les nouveaux tests couvrent coalescence/annulation, neuf alignements/restauration,
actions de la cloche et visibilite sans reconstruction. Les menus geres comptent
maintenant neuf par ecran, avec nettoyage a la desactivation.

Native : neuf positions distinctes, notifications listees et effacees, cloche
masquee/affichee correctement, 24 configurations et trois cycles de vie passes.
Les widgets geres et huit ouvertures de menus systeme passent aussi sur le code differe.
Une double destruction du menu de la cloche, trouvee pendant la validation, a ete
supprimee : le PanelMenu.Button conserve la responsabilite de detruire son menu.

Comparaison mesuree dans le meme protocole headless :
- Temps synchrone des setters : mediane **6.230 ms**, P95 **10.710 ms**, maximum **14.776 ms**.
- Reconstruction differee : exactement une par rafale, mediane **105.640 ms**,
  P95 **140.321 ms**, maximum **211.279 ms** sur 24 reconstructions.
- Travail total setters + reconstruction : mediane **112.330 ms**, contre
  **586.306 ms** avant correction, soit environ **5.2 fois moins**.

La reconstruction reste couteuse; le correctif ne garantit ni zero blocage ni
une cadence de rendu constante sur une session reelle. Il reduit le travail duplique
et le cout synchrone de la rafale, sans deplacer ces couts hors du thread principal.

Preuves : `/home/greg/Documents/.g-os-test-output/notification-perf-fix-olU8RU/`.
Les fichiers `notification-controls.json`, `state-stress.json` et `unit-suite-final.log`
contiennent les validations. Les captures du menu ont ete inspectees.
Modules synchronises : extension.js, panel/panel.js et leurs source maps, compares au build.
Sauvegarde : `/home/greg/.local/state/g-os/backups/notification-perf-ZMcTc8/`.
Reconnexion necessaire pour charger les modules GNOME Shell deja importes.

## Campagne elargie - observations avant correction

Cette seconde campagne porte sur la version installee apres les corrections du Dock.
Seuls les tests ont ete modifies; aucun nouveau module runtime n'a ete deploye.
Les 152 tests fonctionnels restent verts. Cela n'exclut pas les defauts natifs
ci-dessous, qui n'etaient pas verifies par cette suite.

### P1 - Blocages synchrones pendant les rafales de reglages

24 configurations combinent trois positions du Dock, hauteurs de panneau 24/48 px,
tailles d'icones 24/64 px et modes de survol 0/4. Chaque configuration applique
aussi visibilite du Dock, titre actif et menu global. Les valeurs sont dans les bornes du schema.

Deux passages avec mesures en theme clair reproduisent de longs traitements :
- Premier : rafales de sept affectations entre 473.314 et 890.777 ms, mediane 585.362 ms.
- Passage instrumente par cle : entre 491.073 et 821.800 ms, mediane 586.306 ms,
  P95 701.984 ms sur 24 rafales.
- Plus grand changement individuel mesure : position du Dock, 222.703 ms.
- Autres maxima : taille des icones 168.418 ms, visibilite du Dock 169.436 ms,
  hauteur du panneau 131.708 ms, survol 123.533 ms, titre actif 104.159 ms.

La mesure entoure les appels GSettings synchrones, sans les attentes de stabilisation.
Le traitement de `changed` appelle directement la reconstruction `_applySettings`
pour ces cles. Ce sont des blocages du thread principal dans ce protocole, pas une
mesure de FPS soutenu ni une latence de chaque geste utilisateur sur toute machine.
Priorite : regrouper les reconstructions et eviter celles inutiles pour les petits reglages.

### P2 - Reglages de notifications exposes mais sans effet

Une vraie banniere synthetique reste visible pendant les neuf positions choisies.
Toutes donnent les memes coordonnees, environ `(385, 34)` pour une taille `509 x 93`.
Le runtime ne fournit pas `_applyNotificationPosition`, appele seulement de facon optionnelle.
Le selecteur "Position des notifications GNOME" est pourtant present dans les preferences.

Le commutateur "Afficher les notifications" de la topbar est egalement expose,
mais aucun bouton, menu ou libelle de notifications n'est cree, qu'il soit active ou non.
Cela ne concerne pas les badges par application : ne pas confondre les deux fonctions.

### Parcours complementaires reussis

| Domaine | Cas effectivement controles |
| --- | --- |
| Widgets simples | Rendu bureau/Dock, actions et etats persistants independants |
| Flux | HTTP JSON local, partage de sources, boucles Mustache et composants mis a jour |
| Widgets geres | Import, grille, verrouillage, couche de premier plan, glisser-deposer, menus contextuels, mises a jour et retrait |
| Widgets utilitaires | Notes, taches, calculatrice, minuteur, chronometre, horloge mondiale, systeme et stockage; bureau/Dock/formats carres/lateraux |
| Media | Faux lecteur MPRIS, commandes, bureau/Dock/panneau carre/lateral et absence de lecteur |
| Dossiers et piles | Reglages globaux et propres aux dossiers, alignement, survol, grille extreme avec deux axes de defilement; themes clair et sombre |
| Widgets du Dock | Deux tailles, deux formats, trois positions, absence de chevauchement, vrai glisser-deposer et menu de taille; themes clair et sombre |
| Masquage du Dock | Fenetre de test deplacee, minimisee et fermee; revelation au bord et maintien pendant interaction |
| Menus systeme | Huit ouvertures Wi-Fi/Bluetooth/son/batterie aux hauteurs 24/48 px; limites ecran, restauration des acteurs natifs et volume/muet inchanges |
| Recherche | Super+Espace et Ctrl+Alt+Espace, ouverture d'Overview, saisie effective puis desactivation du raccourci |
| Stress de cycle de vie | 24 configurations en sombre et 24 en clair; trois desactivations/reactivations dans chaque theme, sans panneaux residuels ni titres detruits |

Les 48 etats finaux controles sont corrects malgre les longs temps synchrones.
Le focus initial de recherche reste sur WorkspacesDisplay, mais taper `a` alimente
bien la recherche : ce comportement n'est pas classe comme un blocage de saisie.
Le test de menus systeme a un flux audio disponible et ne change ni volume ni mute.

### Limites et hygiene du banc

- Un premier controle de grille apres glisser-deposer etait trop precoce; le placement
  correspond bien a la cellule sauvegardee apres stabilisation de la mise en page.
- Une erreur sur titre detruit a ete observee a l'arret abrupt d'une session de piles.
  Elle ne reapparait pas avec desactivation explicite; les six cycles volontaires
  passent. Pas de preuve d'une panne de titre pendant l'utilisation normale.
- Le conteneur natif des banniers GNOME 51 utilise la liste d'enfants, non l'ancien get_child.
- Les rapports details ne doivent pas partager le chemin de --perf-output : le lanceur
  peut les ecraser. Les fichiers finaux de stress utilisent des chemins distincts.
- Pas de vidage de corbeille, suppression de documents personnels, modification audio,
  connexion reseau externe, verrouillage ou fermeture de la session utilisateur.
- Le multi-moniteur physique, HiDPI, VRR, veille/reprise et la charge GPU reelle restent
  non valides nativement. "Toutes les fonctionnalites" n'est pas une garantie exhaustive.

Preuves, captures, paquets et rapports :
`/home/greg/Documents/.g-os-test-output/full-features-z6f48n/`.
`notification-controls.json`, `search-shortcuts.json`, `panel-controls.json`,
`state-stress.json`, `light/state-stress.json` et `timing/state-stress.json`
contiennent les mesures detaillees. Point d'entree natif : `G_OS_FEATURE_TEST`
avec les valeurs `simple`, `flux`, `widgets`, `utility`, `media`, `folders`,
`stacks`, `dock-widgets`, `coverage`, `notifications`, `shortcuts`, `panel`, `state-stress`.

## Etat final de la premiere campagne

- Build et verifications TypeScript du projet reussis.
- Suite complete : **152/152 tests reussis**, aucun echec ni test ignore.
- Matrice native finale : **12 configurations / 36 points**, survol, infobulle,
  clic attendu et icone survolee entiere dans la vue controles avec succes.
- Retour a taille normale, masquage et reapparition : **12/12**.
- Parcours natif des apercus : delai, annulation et activation reussis sur les trois bords.
- Preferences natives : suite complete reussie sans contournement du code source.
- Modules corriges sauvegardes puis synchronises dans l'installation locale;
  huit fichiers JavaScript/source maps compares au build valide.
- Reconnexion de session necessaire pour recharger les modules GNOME Shell deja importes.

## Perimetre

- GNOME Shell / Mutter 51.1, session headless de 1280 x 720.
- Baseline : paquet construit depuis l'extension effectivement installee.
- Candidat : build des sources, incluant le correctif de magnification non valide.
- Reglages GNOME isoles, fenetres et profils applicatifs temporaires.
- Les premieres phases ci-dessous etaient sans deploiement. Apres validation finale,
  seuls les modules runtime corriges ont ete synchronises, sans changer les reglages.

## Priorites

### P1 - Survol et clic perdus sur les icones agrandies

Reproduit avec le pointeur virtuel natif sur la baseline, dans les 12 configurations :
Dock bas/gauche/droite, icones de 32/64 px et magnification de 180/400 %.
Chaque configuration teste trois points dans l'icone apres stabilisation.

| Mesure | Installee | Candidat initial non installe |
| --- | ---: | ---: |
| Configurations | 12 | 12 |
| Points testes | 36 | 36 |
| Survol/ciblage incorrect | 18 | 21 |
| Infobulle absente | 18 | 21 |
| Activation attendue absente | 18 | 21 |
| Autre application activee | 0 | 0 |

Les echecs se concentrent sur la partie agrandie situee hors du bouton initial.
Le candidat initial n'est pas une correction valide : ne pas le deployer.
L'activation est interceptee dans le scenario pour compter les clics sans lancer d'applications.

### P2 - Retour de magnification intermittent apres sortie

Sur le dernier passage baseline, Dock bas, taille 32 px, maximum 180 % :
echelle encore a 1.378125 apres 250 ms hors du Dock.
Les passages precedents revenaient a 1 : comportement intermittent, a confirmer
sur une duree plus longue avant de parler de blocage permanent.

### P1 - Crash natif lors du premier changement d'icone

Le processus GJS du test GTK se termine avec le statut 139 dans deux environnements :
backend graphique par defaut, puis X11 avec rendu logiciel et accessibilite desactivee.
Le sous-test minimal confirme que le crash arrive pendant `selector.selected = index`
au choix de `starred-symbolic`, avant que cette affectation ne retourne.
La trace native conservee confirme un SIGSEGV dans `g_object_notify_by_pspec`,
appele depuis un setter de propriete GJS.

Le rafraichissement des preferences remplace le modele du selecteur pendant la
notification de selection. En conservant le modele dans une variante chargee
uniquement par le banc, le sous-test passe, puis le test complet des preferences
et du gestionnaire de widgets passe egalement. Cette comparaison localise le
declencheur; elle ne constitue pas un correctif de production valide pour les
changements de theme ou l'ajout de nouveaux noms d'icones.

Reproduction minimale sur l'ancien build : `G_OS_PREFS_LAUNCHERS_ONLY=1` dans
[tests/prefs-native.js](tests/prefs-native.js). La variante temporaire utilisait
`G_OS_PREFS_STABLE_MODEL_PROBE=1`; ce contournement a ete retire du banc apres
validation du correctif source decrit plus bas. Aucun essai ne modifie les preferences installees.

## Diagnostic complementaire du ciblage

Le cas candidat bas/32 px/180 % a ete repris avec magnification figee dans le banc,
pour exclure un simple mouvement du dessin pendant le clic :

- Point cible : environ `(550, 648.72)`, pointeur natif observe `(550, 648)`.
- Bouton avant/apres : rectangle `(514, 630, 72, 72)`, inchange.
- Icone avant/apres : environ `(521.20, 637.20, 57.60, 57.60)`, inchangee.
- Point dans l'icone ET le bouton avant et apres le mouvement.
- Contenu du Dock : rectangle `(386, 656, 508, 52)`; le point est hors de ce contenu.
- Acteur effectivement cible : `St.ScrollView`, pas le bouton; aucune activation.

L'agrandissement du bouton sous le meme conteneur ne resout donc pas le ciblage
hors des limites du contenu. La correction doit tenir compte de la hierarchie
de picking, pas seulement des dimensions peintes ou du facteur de zoom.
Les options `G_OS_EXPLORATORY_CASE=0,32,180` et `G_OS_DOCK_FREEZE_PICK_PROBE=1`
isolent cette experience. Le mode fige est un diagnostic, pas un comportement utilisateur.

Le test complet des preferences, avec la variante de modele stable uniquement,
a maintenant valide les selections d'icones, les options globales/par dossier,
la reinitialisation et le catalogue/configuration/import/desinstallation des widgets.

## Transitions et temps entre images

- Transition d'entree presente dans les 12 cas de chaque build.
- Masquage et reapparition du Dock : 12/12 dans chaque build.
- Retour a taille normale : 11/12 sur le dernier passage baseline, 12/12 candidat.
- Baseline, dernier passage : 120 intervalles entre images pendant les entrees,
  P95 par cas de 17.136 a 19.910 ms, maximum de 24.824 ms.
- Candidat : 120 intervalles, P95 par cas de 17.285 a 19.276 ms, maximum de 23.339 ms.

Ces courts echantillons headless ne constituent ni un benchmark de FPS soutenu,
ni une garantie d'absence de saccades sur l'ecran reel. Les temps hors animation
ne sont pas melanges aux echantillons d'entree.

## Parcours natifs reussis sur la baseline

- Cover Flow : Alt+Tab, navigation, relachement Alt, Echap, fermeture de fenetre,
  disposition compacte et desactivation.
- Apercus du Dock : delai, annulation, clones de deux vraies fenetres, maintien
  du survol et clic d'activation, sur les trois positions.
- Overview : retrait/restauration de la reservation du Dock pendant la transition.
- Grille : favoris visibles, dossiers avant applications, ordre alphabetique et nettoyage.
- Grille vers Dock : ajout unique aux favoris, sans creer un dossier a une application.
- Menus GTK et DBusMenu : focus, actions, etats coches et nettoyage.
- Inkscape Flatpak : dix menus dans les limites de l'ecran et action Quitter dans le menu du titre.

## Suite automatisee

Build et verifications TypeScript du projet reussis. Au debut de l'audit,
suite fonctionnelle : **143/151**, soit **8 echecs**.

Les echecs ne sont pas huit bugs utilisateur prouves :
- Preferences : mock de theme sans methode `connect`.
- Widgets : attente de deux abonnements d'horloge contre trois observes.
- Deux tests d'animation : attentes sur l'echelle locale de l'icone incompatibles avec le candidat.
- Menus multi-ecrans : ancien compte de 14 menus contre 16 depuis l'ajout du menu du titre.
- Activation par espace de travail : mock de fenetre sans methode `unminimize`.
- Bureau et attention : assertions de zero signaux sur des fenetres encore suivies;
  distinguer abonnements legitimes et fuite avant de conclure.

## Banc et preuves

Le scenario reproductible est dans [tests/gnome-visual.js](tests/gnome-visual.js),
active par `G_OS_EXPLORATORY_TEST=1` avec `MACOS_VISUAL_OUTPUT` pour les resultats.
Il mesure l'infobulle avant le clic, reinitialise le pointeur entre points et
collecte les problemes sans arreter la matrice au premier echec.

L'appel obsolete a `Clutter.get_default_backend()` a ete remplace dans les tests
par le backend du contexte de stage. La fin du scenario exploratoire ne concurrence
plus la fermeture de PerfHelper. Le dernier passage baseline et le candidat
terminent avec un statut nul, meme si leurs rapports contiennent des anomalies.

Journaux complets, paquets de reference, captures et JSON de mesures conserves dans :
`/home/greg/Documents/.g-os-test-output/exploratory-e9T9N6/`.
La sortie des 151 tests est dans `/home/greg/Documents/.g-os-test-output/exploratory-unit.log`.

## Limites

Pas de validation native multi-moniteurs physiques, HiDPI, taux de rafraichissement
variables, lecteur d'ecran, veille/reprise, session verrouillee ou charge GPU reelle.
Les tests unitaires couvrent plusieurs moniteurs simules, sans remplacer ces essais.
Pas de suppression de vrais fichiers, de vidage de corbeille, de changement audio
ou de mise a jour de reglages persistants dans la session utilisateur.

## Correctifs candidats et validation complementaire - historique

### Preferences

[src/prefs.ts](src/prefs.ts) conserve maintenant le modele du selecteur quand la
liste de noms n'a pas change et evite une affectation redundante de la selection.
Un nouveau nom configure provoque toujours une reconstruction de la liste.
Le test natif complet passe sur ce code reel, sans remplacement de source dans le banc :
selection de deux icones existantes, conservation des modeles, ajout d'un nom absent,
previsualisation, reinitialisation, options de dossiers et gestionnaire de widgets.

### Dock

Le contenu agrandi est place dans un `St.Viewport` intermediaire sans marges,
uniquement en mode magnification. Les ajustements de defilement portent sur cette
enveloppe; le contenu interne conserve la reserve d'espace sans porter ces ajustements.
Cela evite le clip de picking impose par `st_viewport_pick` sur les marges du contenu.
Deplacer seulement les marges sans separer les ajustements avait echoue.

Le nouveau candidat passe les controles d'interaction dans les 12 configurations :
**36/36 points** avec survol, infobulle et clic correct; retour a l'echelle 1,
masquage et reapparition **12/12**. Les apercus de fenetres passent aussi sur les trois bords.
Les 12 tests unitaires cibles couvrant geometrie, marges, animations et defilement passent.

Les captures a 400 % montrent encore des portions d'icones rognees aux limites de
la vue defilante. Le controle des points de clic ne valide pas toute la surface peinte.
Le marqueur de transition observe a un instant fixe n'est present que dans 7/12 cas
de ce passage; cela reste a mesurer plus finement avant de conclure a cinq transitions absentes.
Le candidat Dock n'est donc pas declare visuellement finalise et n'est pas deploye.

Suite fonctionnelle complete apres ces changements : **145/151**, soit **6 echecs**.
Les deux tests d'animation desormais verts mesurent l'echelle effective et fournissent
un pointeur dans le fond du Dock; leurs controles de duree et de rebond sont conserves.
Les six autres echecs listes plus haut, hors ces deux tests, restent ouverts.

### Fiabilite du banc

Le banc retrouve maintenant le bouton courant apres les attentes et attend la fin
de la mise en page avant les mesures finales. Un passage intermediaire avait clique
un bouton reconstruit non intercepte et lance une application dans la session isolee;
l'interception est desormais placee sur le controleur commun d'activation, y compris
pour les nouveaux boutons. Les essais suivants se terminent sans ce lancement parasite.
Les comptages historiques et nouveaux ne doivent pas etre presentes comme un benchmark
A/B strict : le protocole a aussi ete renforce.

Preuves du nouveau candidat :
`/home/greg/Documents/.g-os-test-output/dock-viewport-fix-68N9xL/`.
Preuve du test natif des preferences sans contournement :
`/home/greg/Documents/.g-os-test-output/exploratory-e9T9N6/preferences-source-fix.log`.

## Resolution finale

Les six derniers echecs ont ete corriges sans retirer de controles fonctionnels :
le faux theme fournit les signaux GTK; le nombre d'abonnements d'horloge tient
compte du widget duplique sur les ecrans; les menus comptent le nouveau menu du titre;
les fausses fenetres implementent minimisation/restauration; le nettoyage verifie
les identifiants appartenant au Bureau/Attention puis l'absence de tout abonnement
a la desactivation, au lieu de confondre ces derniers avec les observateurs des menus.

La reserve de magnification etait encore ajoutee une seconde fois lors du placement.
Le clip supplementaire supprimait ensuite une partie de cette reserve. Le placement
utilise maintenant la taille naturelle complete et le clip normal de la vue defilante.
Un nouveau test interdit ce double comptage; le banc natif controle aussi le rectangle
entier de l'icone survolee. Les icones hors champ d'une liste defilante ne sont pas
promises toutes visibles simultanement a 400 %.

Les evenements repetes visant la meme echelle et le meme decalage ne remplacent
plus une transition en cours par une affectation instantanee. Un test de regression
controle cette preservation, sans ralentir la vague quand la cible change reellement.
Le marqueur natif observe a un instant fixe reste une mesure de diagnostic sensible
au timing et aux reconstructions, pas une preuve d'absence de transition ou un benchmark de FPS.

Preuves finales : `/home/greg/Documents/.g-os-test-output/dock-final-fix-Fbhkda/`,
dont `smooth/` pour la derniere matrice, et
`/home/greg/Documents/.g-os-test-output/all-fixes-unit-final.log` pour les 152 tests.
Les captures ont ete inspectees sur le Dock bas et lateral a 400 %.
Sauvegarde des huit fichiers runtime precedents :
`/home/greg/.local/state/g-os/backups/runtime-fixes-HJMkfe/`.