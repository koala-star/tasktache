# Blindify

Blindify est une application web de blind test à jouer à plusieurs autour d’un écran. Elle ne nécessite aucun build : lancez `npm start`, puis ouvrez `http://127.0.0.1:4173`.

## Ce qui est inclus

- une landing page responsive, une sélection de morceaux, la configuration de partie, le compte à rebours, la révélation, le score et le podium ;
- des fichiers locaux joués uniquement dans le navigateur via `URL.createObjectURL()` (aucun envoi, aucune sauvegarde en base64) ;
- la recherche YouTube Data API v3 et un lecteur IFrame API officiel, activés uniquement après saisie d’une clé API publique restreinte par référent ;
- un connecteur de catalogue Deezer avec recherche, aperçu unique et ajout à la sélection lorsqu’un `preview` est fourni par l’API ;
- stockage local des préférences légères (volume, joueurs, configuration et clé API publique), jamais des fichiers audio.

## YouTube et mode aveugle strict

L’intégration YouTube utilise uniquement les APIs officielles et ne télécharge ni n’extrait aucun média. Les politiques du lecteur imposent toutefois que le lecteur et son attribution restent visibles ; une vidéo YouTube ne peut donc pas garantir un écran réellement sans indice. Blindify conserve le lecteur YouTube dans un **mode hôte visible** (recherche, playlists, test de segment, volume, pause/reprise/arrêt) et exclut ces vidéos des manches « sans spoiler » jouées sur le même écran.

Les fichiers locaux et les aperçus de catalogue explicitement permis par le fournisseur sont les sources compatibles avec le blind test strict.

## Configurer YouTube

1. Créez une clé API dans Google Cloud et activez **YouTube Data API v3**.
2. Restreignez impérativement la clé aux référents HTTP(S) de votre déploiement ; ne placez jamais une clé serveur ou OAuth secrète dans le navigateur.
3. Dans Blindify, ouvrez `YouTube`, choisissez `Configurer la recherche`, puis collez cette clé publique.

Le code appelle `search.list`, `playlistItems.list` et `videos.list` ; le lecteur officiel utilise `loadVideoById({ videoId, startSeconds, endSeconds })`.

## Catalogue musical

Le connecteur Deezer interroge seulement le catalogue et les URLs d’aperçu officiellement retournées par son API. Avant toute mise en production, vérifiez que votre usage et votre territoire sont couverts par les conditions du fournisseur. L’application ne s’appuie pas sur iTunes / Apple Music, Spotify, scraping, DRM contournés ou URLs audio demandées aux joueurs.

## Navigation

- **Mes fichiers** : ajoutez plusieurs fichiers par bouton ou glisser-déposer. Les métadonnées MP3 ID3 simples et le format `Artiste - Titre.ext` sont reconnus quand possible.
- **Bibliothèque** : recherchez un titre, artiste, album ou genre, écoutez un seul aperçu à la fois, puis ajoutez-le.
- **Ma sélection** : réordonnez, mélangez ou retirez les morceaux avant de démarrer.

Les fonctionnalités dépendent des capacités du navigateur et de la disponibilité des fournisseurs.
