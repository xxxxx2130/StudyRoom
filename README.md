# SchoolRoom

Application de réservation de salles avec comptes utilisateurs, agenda hebdomadaire et espace d’administration.

Les étudiants et enseignants connectés peuvent rechercher les salles disponibles par créneau et capacité, puis réserver instantanément : toute réservation sur un créneau libre est confirmée automatiquement. Ils peuvent suivre leurs propres réservations. Le calendrier global et les outils de gestion sont réservés aux administrateurs. Les réservations qui se chevauchent sont rejetées, y compris lors de demandes simultanées.

L’interface propose un mode clair ou sombre et trois tailles de texte. Ces préférences sont enregistrées dans le navigateur.

## Vérifications fonctionnelles

- Se connecter avec un compte existant en choisissant le rôle associé au compte, ou créer un compte étudiant/enseignant.
- Vérifier qu’un étudiant ou enseignant ne voit pas le calendrier global ; tenter d’appeler `/api/calendar` avec son compte doit renvoyer `403`.
- En tant qu’étudiant ou enseignant, rechercher dans « Disponibilités » une salle avec une date, une heure de début et de fin, et une capacité minimale. Une salle occupée ou indisponible sur une partie du créneau ne doit pas apparaître dans les résultats.
- Choisir une salle, saisir un motif et confirmer la réservation. Le message indique le nom de la salle et le créneau ; son statut est « Confirmée » immédiatement.
- Envoyer simultanément deux demandes pour la même salle et le même créneau : une seule doit réussir.
- Utiliser les commandes du mode clair/sombre et de taille de texte ; les choix sont conservés après rechargement.
- Parcourir les formulaires et les commandes au clavier ; le focus doit rester visible.

## Démarrage local

Prérequis : Node.js, npm et Docker avec Docker Compose.

1. Installer les dépendances à la racine du projet :

   ```bash
   npm install
   ```

2. Configurer la base de données et le premier compte administrateur :

   ```bash
   cp backend/.env.example backend/.env
   ```

   Modifiez `ADMIN_EMAIL` et remplacez `ADMIN_PASSWORD` par un mot de passe privé d’au moins 12 caractères.

3. Démarrer PostgreSQL et créer le schéma :

   ```bash
   npm run db:up
   npm run db:migrate
   npm run db:seed
   npm run admin:create
   ```

4. Dans deux terminaux, démarrer le serveur et le site :

   ```bash
   npm run dev:backend
   ```

   ```bash
   npm run dev:frontend
   ```

   Ouvrez ensuite <http://127.0.0.1:5173>. Connectez-vous avec les identifiants administrateur configurés dans `backend/.env`.

L’inscription permet de créer un compte étudiant ou enseignant. Le choix « Administration » à la connexion ne donne pas les droits administrateur : ceux-ci sont réservés au compte configuré par `admin:create`. L’administrateur peut consulter le calendrier global, modifier les salles, gérer les indisponibilités et traiter les demandes. Après une reconnexion, l’application ouvre la vue correspondant au rôle du compte.

## Déploiement sur Railway

Le `Dockerfile` construit le frontend et le backend dans un même service. En production, le backend sert aussi les fichiers du frontend et applique les migrations avant de démarrer.

1. Publiez le code sur GitHub sans ajouter de fichier `.env`. Le dépôt doit contenir le `Dockerfile` et le `.dockerignore`.
2. Dans Railway, créez un projet depuis ce dépôt GitHub, puis ajoutez un service PostgreSQL.
3. Dans les variables du service SchoolRoom, configurez :
   - `DATABASE_URL` avec la référence à la variable `DATABASE_URL` du service PostgreSQL Railway ;
   - `ADMIN_EMAIL` avec l’adresse du compte administrateur ;
   - `ADMIN_PASSWORD` avec un mot de passe privé d’au moins 12 caractères ;
   - `ADMIN_FIRST_NAME` et `ADMIN_LAST_NAME` si vous souhaitez personnaliser le nom affiché.
4. Déployez le service et générez un domaine public depuis ses paramètres réseau. Railway fournit HTTPS pour ce domaine.
5. Connectez-vous avec les identifiants configurés. Les salles peuvent ensuite être ajoutées depuis la section « Gestion ».

À chaque démarrage, le service applique les migrations et crée ou met à jour le compte administrateur à partir des variables configurées. Gardez ces variables privées et ne placez jamais les identifiants de production dans un fichier `.env` versionné.

## Compilation

```bash
npm run build
```
# StudyRoom
