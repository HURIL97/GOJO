# Officia — l’assistant administratif tout-en-un

Application Windows pour **assistante de direction et secrétariat** : agenda, rendez-vous, réunions et procès-verbaux, messagerie, courrier, appels, tâches, rappels et notifications, réunis dans une interface simple, élégante et professionnelle.
Tout fonctionne **sans Internet** (base locale sur le poste) ; la messagerie envoie et relève vos e-mails dès que la connexion est disponible.

![Ma journée](docs/accueil.png)

| Agenda | Procès-verbal | Messagerie |
|---|---|---|
| ![](docs/agenda.png) | ![](docs/pv.png) | ![](docs/messagerie.png) |

## Fonctionnalités

### Ma journée
Tableau de bord du matin : prochain rendez-vous avec compte à rebours et bouton « Rejoindre » pour les visioconférences, programme de la journée en frise chronologique, tâches du jour à cocher, rappels, charge de la semaine, répartition par type, derniers messages, réunions à venir et **PV à rédiger**, appels à rappeler, pense-bêtes. Impression de l’**agenda du jour** pour la personne assistée.

### Agenda et rendez-vous
- Vues **jour, semaine, mois, liste** ; cliquer sur un créneau libre crée un évènement.
- Types colorés : réunion, rendez-vous, appel, déplacement, échéance, personnel.
- **Détection des conflits** d’agenda pendant la saisie, **récurrences** (quotidienne, hebdomadaire, mensuelle, annuelle), participants, lieu, lien de visio, statut (planifié, confirmé, reporté, annulé).
- **Confirmation de rendez-vous par e-mail** en un clic (modèle prérempli).

### Réunions et procès-verbaux
Parcours complet en 5 étapes : **Préparation → Convocation → Séance → PV validé → PV diffusé**.
- Ordre du jour (intervenants, durées), participants depuis les contacts.
- **Convocation** mise en page (PDF) et envoyée par e-mail aux participants en pièce jointe.
- **Feuille de présence** (présent / excusé / absent), rédaction du PV point par point (échanges + décisions), relevé des actions avec responsables et échéances.
- Les **actions du PV deviennent automatiquement des tâches** suivies.
- **PV officiel en PDF** (présences, décisions, actions, signatures), validation et diffusion par e-mail.

### Messagerie
- Comptes **IMAP / SMTP** (Gmail, Outlook, Yahoo, Orange préremplis, ou tout serveur professionnel). Mot de passe **chiffré par Windows**.
- Boîte de réception, favoris, envoyés, brouillons, **boîte d’envoi hors ligne** (les messages partent automatiquement au retour de la connexion), archives, corbeille.
- **Modèles** avec variables (`{{nom}}`, `{{date}}`, `{{heure}}`, `{{lieu}}`, `{{objet}}`, `{{signature}}`…), signature, pièces jointes, suggestions de destinataires.
- Transformer un message en **tâche** ou en **rendez-vous**. Affichage HTML sécurisé (scripts et images distantes bloqués).

### Tâches et rappels
- **Tableau** glisser-déposer (À faire, En cours, En attente, Terminé), vue liste, priorités, échéances, responsables.
- **Rappels** à date et heure, récurrents, « +10 min » pour reporter.

### Notifications
- **Notifications Windows** (même application réduite) : évènement imminent selon le délai choisi, rappel arrivé à échéance, récapitulatif quotidien des tâches, courriers à échéance, appel urgent, nouveaux e-mails.
- Centre de notifications dans l’application, compteurs dans le menu, icône près de l’horloge Windows (l’application reste active fenêtre fermée), lancement au démarrage de Windows en option.

### Courrier
**Registre du courrier arrivée et départ** avec numérotation chronologique automatique (`A-2026-0001`, `D-2026-0001`), expéditeur/destinataire, objet, référence, mode de réception, attribution, échéance de traitement, statut, **scan joint**. Impression du registre et export Excel.

### Appels
Journal des **messages téléphoniques** (« pendant votre absence ») : appelant, société, numéro, pour qui, message, urgence ; « Rappelé » en un clic ou planification du rappel dans l’agenda.

### Contacts
Annuaire avec favoris, étiquettes, coordonnées, et **historique** par contact (rendez-vous, appels, courriers) ; actions directes : écrire, planifier, noter un appel.

### Et aussi
**Recherche globale** (`Ctrl+K`) dans tout : contacts, agenda, réunions, PV, tâches, messages, courrier, appels · bouton **Nouveau** (`Ctrl+N`) · thème sombre / clair · **verrouillage par code** · sauvegarde automatique quotidienne, sauvegarde et restauration manuelles · exports Excel.

---

## Installation sur Windows

1. Sur GitHub, onglet **Actions** › **« Officia — installateur Windows »** (lancé automatiquement à chaque modification du dossier `officia/`, ou via **Run workflow**).
2. Téléchargez l’artefact **Officia-Windows** : il contient `Officia-Setup-1.0.0.exe` et une version portable.
3. Lancez l’installateur. Si SmartScreen s’affiche : **Informations complémentaires** › **Exécuter quand même** (application non signée).

Construire soi-même sur un PC Windows (Node.js 24) :
```bash
cd officia
npm install
npm run dist:win     # → release/Officia-Setup-1.0.0.exe
```

### Premier démarrage
Saisissez votre nom, votre fonction, l’organisation et la personne assistée. Cochez **données de démonstration** pour découvrir l’application avec un agenda, des réunions (dont un PV complet), des messages, des courriers et des appels fictifs.
Ajoutez ensuite votre adresse e-mail dans **Paramètres › Messagerie** (bouton « Tester la connexion »). Pour Gmail ou Outlook avec validation en deux étapes, utilisez un **mot de passe d’application**.

---

## Développement

```bash
cd officia
npm install
npm run dev     # Vite + Electron
npm test        # agenda, récurrences, conflits, PV → tâches, notifications, courrier, envoi SMTP réel et boîte d’envoi hors ligne
```

| Dossier | Rôle |
|---|---|
| `electron/db.js` | Base SQLite locale (`node:sqlite` intégré à Electron, aucun module natif) |
| `electron/services.js` | Agenda et récurrences, conflits, réunions/PV, tâches, rappels, planificateur de notifications, courrier, appels, recherche, tableau de bord |
| `electron/mail.js` | Messagerie : SMTP (nodemailer), IMAP (imapflow + mailparser), boîte d’envoi hors ligne |
| `electron/main.js` | Fenêtre, zone de notification, notifications Windows, PDF, IPC, sauvegardes |
| `src/` | Interface React |

Données : `%APPDATA%\Officia\data\` (sauvegardes dans `sauvegardes\`, pièces jointes dans `fichiers\`).
