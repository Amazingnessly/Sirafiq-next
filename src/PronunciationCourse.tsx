import { useMemo, useState } from 'react';

type Lesson = {
  id: string;
  title: string;
  objective: string;
  principles: string[];
  drills: string[];
  checkpoint: string;
};

type CourseModule = {
  id: string;
  level: string;
  title: string;
  summary: string;
  lessons: Lesson[];
};

type Props = {
  completed: string[];
  onCompletedChange: (lessonIds: string[]) => void;
  storageWarning?: string;
  onClose: () => void;
};

const modules: CourseModule[] = [
  {
    id: 'fondations',
    level: 'Fondations',
    title: 'Installer l’outil vocal',
    summary: 'Respiration, posture, écoute et précision syllabique avant de travailler les sons isolés.',
    lessons: [
      {
        id: 'souffle-posture',
        title: 'Souffle, posture et détente',
        objective: 'Produire une voix stable sans serrer la gorge ni pousser le volume.',
        principles: [
          'Ancrage : pieds stables, nuque libre, sternum disponible, mâchoire non verrouillée.',
          'Respiration silencieuse et basse : laisser l’abdomen et les côtes s’ouvrir sans lever les épaules.',
          'La projection vient d’un souffle régulier et d’une articulation nette, pas d’un cri.',
        ],
        drills: [
          '5 cycles : inspirer calmement 4 temps, expirer sur « s » pendant 8 temps.',
          'Dire « bonjour », puis une phrase de 8 à 12 mots sur une seule expiration confortable.',
          'Lire trois lignes en gardant la mâchoire souple et les épaules immobiles.',
        ],
        checkpoint: 'Je peux lire 20 à 30 secondes avec un débit stable sans finir mes phrases à bout de souffle.',
      },
      {
        id: 'ecoute-discrimination',
        title: 'Écouter avant de corriger',
        objective: 'Distinguer un contraste sonore avant d’essayer de le produire.',
        principles: [
          'Une correction durable commence par la perception : identifier le son, puis le reproduire.',
          'Comparer deux réalisations proches aide davantage que répéter mécaniquement un mot isolé.',
          'S’enregistrer permet de séparer ce que l’on croit avoir dit de ce qui est réellement audible.',
        ],
        drills: [
          'Alterner lentement « tu / tout », « des / dès », « peu / peur » et écouter le changement de voyelle.',
          'S’enregistrer sur une phrase, attendre 30 secondes, puis noter un seul point à corriger.',
          'Répéter la même phrase trois fois : très lentement, normalement, puis en lecture expressive.',
        ],
        checkpoint: 'Je peux identifier au moins un écart précis dans mon propre enregistrement sans juger globalement ma voix.',
      },
      {
        id: 'syllabes-rythme',
        title: 'Syllabes et régularité du français',
        objective: 'Sortir d’un rythme mot à mot et installer une parole plus liée.',
        principles: [
          'Le français organise fortement le rythme par groupes de mots, et non par accent fort sur chaque mot lexical.',
          'Les syllabes d’un même groupe tendent vers une durée relativement régulière.',
          'La dernière syllabe pleine du groupe reçoit généralement l’accent principal du groupe.',
        ],
        drills: [
          'Frapper doucement une pulsation sur chaque syllabe : « Je / vais / vous / ex / pli / quer ».',
          'Lire « Dans quelques minutes / nous commencerons / le premier exercice » en trois groupes.',
          'Reprendre la phrase sans pauses internes aux groupes, puis allonger légèrement leur dernière syllabe.',
        ],
        checkpoint: 'Je peux lire une phrase en groupes rythmiques sans accentuer artificiellement chaque mot.',
      },
    ],
  },
  {
    id: 'voyelles-orales',
    level: 'A1 → B1',
    title: 'Maîtriser les voyelles orales',
    summary: 'Placement de la langue et des lèvres, contrastes utiles et rôle du e instable.',
    lessons: [
      {
        id: 'i-y-u',
        title: '/i/, /y/, /u/ : trois placements distincts',
        objective: 'Éviter les confusions entre « si », « su » et « sous ».',
        principles: [
          '/i/ : langue haute vers l’avant, lèvres étirées.',
          '/y/ : langue proche de /i/ mais lèvres arrondies ; c’est un son central du français.',
          '/u/ : langue haute plus en arrière, lèvres arrondies et projetées.',
        ],
        drills: [
          'Séries : « si – su – sous », « lit – lu – loup », « vie – vue – vous ».',
          'Tenir chaque voyelle deux secondes sans déplacer la mâchoire en cours de son.',
          'Phrase : « Tu as vu tous les outils sur le mur. »',
        ],
        checkpoint: 'Un auditeur peut distinguer mes trois séries /i y u/ sans contexte.',
      },
      {
        id: 'e-epsilon',
        title: '/e/ et /ɛ/ : fermer sans tendre, ouvrir sans relâcher',
        objective: 'Stabiliser des contrastes comme « été » / « était » et améliorer la netteté des finales.',
        principles: [
          '/e/ est plus fermé ; /ɛ/ est plus ouvert.',
          'Les réalisations varient selon les régions et certains contextes : viser d’abord une opposition claire quand elle est pertinente.',
          'La graphie ne suffit pas à prédire le son ; l’écoute du mot réel reste prioritaire.',
        ],
        drills: [
          'Alterner « mes / mais », « fée / fait », « parler / parlait ».',
          'Lire : « J’ai préparé les clés que j’avais laissées près de l’entrée. »',
          'Reprendre la phrase en exagérant légèrement l’ouverture, puis revenir à une diction naturelle.',
        ],
        checkpoint: 'Je peux produire /e/ et /ɛ/ sans que la distinction dépende uniquement du volume ou de la durée.',
      },
      {
        id: 'eu-oe-o-ouvert',
        title: '/ø/, /œ/, /o/, /ɔ/ : arrondir avec précision',
        objective: 'Éviter que plusieurs voyelles arrondies se réduisent à un même son.',
        principles: [
          '/ø/ est plus fermé que /œ/ ; /o/ est plus fermé que /ɔ/.',
          'Les lèvres s’arrondissent sans avancer excessivement la mâchoire.',
          'Les oppositions varient selon l’accent régional : l’objectif principal reste l’intelligibilité stable.',
        ],
        drills: [
          'Séries : « peu / peur », « jeûne / jeune », « paume / pomme », « côte / cote ».',
          'Phrase : « Paul veut encore deux heures pour revoir son cours. »',
          'S’enregistrer en gardant le même débit sur chaque paire.',
        ],
        checkpoint: 'Mes voyelles arrondies restent distinctes sans grimace ni tension visible.',
      },
      {
        id: 'schwa',
        title: 'Le e instable /ə/',
        objective: 'Comprendre quand le schwa soutient la clarté et quand il peut s’effacer.',
        principles: [
          'Le schwa est variable : sa présence dépend du registre, du débit, de la région et de l’environnement consonantique.',
          'Le supprimer partout produit une diction heurtée ; le maintenir partout peut rendre la parole lourde.',
          'En lecture publique, conserver certains schwas peut améliorer la clarté d’un groupe consonantique difficile.',
        ],
        drills: [
          'Comparer « je te le demande » en débit lent puis naturel.',
          'Lire « mercredi », « seulement », « gouvernement » en cherchant une articulation fluide, non mécanique.',
          'Tester deux versions d’une phrase et conserver celle qui reste la plus intelligible.',
        ],
        checkpoint: 'Je peux adapter la présence du schwa au débit sans perdre de consonnes importantes.',
      },
    ],
  },
  {
    id: 'nasales-glides',
    level: 'A2 → B1',
    title: 'Voyelles nasales et semi-voyelles',
    summary: 'Nasalité contrôlée et enchaînement fluide avec /j/, /ɥ/ et /w/.',
    lessons: [
      {
        id: 'nasales',
        title: '/ɑ̃/, /ɛ̃/, /ɔ̃/ et variation de /œ̃/',
        objective: 'Produire une nasalité stable sans ajouter un [n] ou un [m] final audible.',
        principles: [
          'La voyelle reste le noyau du son ; la nasalité ne doit pas devenir une consonne finale ajoutée.',
          'Les oppositions « blanc / blond », « vent / vin », « bon / bain » demandent des placements buccaux distincts.',
          'Le contraste /œ̃/–/ɛ̃/ est conservé dans certaines variétés et neutralisé dans d’autres : reconnaître cette variation évite de surcorriger.',
        ],
        drills: [
          'Tenir « an – in – on » sur une même intensité, sans [n] final.',
          'Séries : « sans / sain / son », « banc / bain / bon », « lent / lin / long ».',
          'Phrase : « Un enfant prend son temps avant de répondre. »',
        ],
        checkpoint: 'Je peux changer de voyelle nasale sans ajouter une consonne nasale finale parasite.',
      },
      {
        id: 'semi-voyelles',
        title: '/j/, /ɥ/, /w/ : glisser sans ajouter une syllabe',
        objective: 'Rendre les suites vocaliques plus naturelles et plus rapides.',
        principles: [
          '/j/ apparaît notamment dans « hier », « pied », « travail ».',
          '/ɥ/ combine un geste proche de /y/ avec un passage rapide vers la voyelle suivante : « huit », « nuit ».',
          '/w/ accompagne souvent /u/ vers une autre voyelle : « oui », « loin », « trois ».',
        ],
        drills: [
          'Séries : « pied – puis – poids », puis « lien – lui – loin ».',
          'Dire « huit », « huile », « nuage », « jouer » sans insérer de voyelle supplémentaire.',
          'Phrase : « Louis voit trois vieux livres près de lui. »',
        ],
        checkpoint: 'Les semi-voyelles restent brèves et n’ajoutent pas une syllabe au mot.',
      },
      {
        id: 'oral-nasal-contrasts',
        title: 'Contrastes oral / nasal',
        objective: 'Passer volontairement d’une voyelle orale à sa voisine nasale sans brouiller le mot.',
        principles: [
          'La nasalité est un trait distinctif : elle peut suffire à changer le mot perçu.',
          'Le contrôle vient d’une comparaison directe oral/nasal, pas d’une nasalisation générale de toute la phrase.',
          'La consonne qui suit doit rester nette lorsque le mot en comporte réellement une.',
        ],
        drills: [
          'Comparer « bas / banc », « beau / bon », « paix / pain », « là / lent ».',
          'Lire deux fois une phrase : d’abord lentement en ciblant les voyelles, puis à débit conversationnel.',
          'S’enregistrer et vérifier qu’une voyelle orale voisine ne devient pas nasale par anticipation.',
        ],
        checkpoint: 'Je contrôle la nasalité mot par mot au lieu de nasaliser tout le groupe de souffle.',
      },
    ],
  },
  {
    id: 'consonnes',
    level: 'A1 → B2',
    title: 'Consonnes nettes et finales maîtrisées',
    summary: 'Voisement, /ʁ/, groupes consonantiques et lettres finales sans lecture mécanique de l’orthographe.',
    lessons: [
      {
        id: 'voisement',
        title: 'Sourdes et sonores',
        objective: 'Stabiliser les couples /p b/, /t d/, /k g/, /f v/, /s z/, /ʃ ʒ/.',
        principles: [
          'Les couples partagent souvent le même point d’articulation ; la différence essentielle est la vibration des cordes vocales.',
          'Une consonne finale sonore peut s’affaiblir chez certains locuteurs : viser d’abord la distinction perceptible.',
          'Le voisement ne doit pas ajouter une voyelle après la consonne.',
        ],
        drills: [
          'Main sur le larynx : alterner « sss / zzz », « fff / vvv », « ch / j ».',
          'Paires : « poisson / boisson », « tout / doux », « cache / cage ».',
          'Phrase : « Vous posez doucement chaque dossier sur la table. »',
        ],
        checkpoint: 'Je peux faire entendre le contraste sans augmenter fortement l’intensité de la consonne sonore.',
      },
      {
        id: 'r-francais',
        title: 'Le /ʁ/ français sans tension excessive',
        objective: 'Produire un /ʁ/ intelligible, stable et compatible avec un débit naturel.',
        principles: [
          'Le /ʁ/ standard courant est généralement produit vers l’arrière de la bouche, mais sa réalisation varie beaucoup entre locuteurs.',
          'L’objectif n’est pas une friction maximale : un son trop forcé fatigue et ralentit la parole.',
          'Travailler /ʁ/ entre voyelles est souvent plus facile avant les groupes consonantiques.',
        ],
        drills: [
          'Commencer par « ara – iri – ourou », puis « rare – rire – route ».',
          'Passer à « très », « prendre », « croire », « propre » sans ralentir exagérément.',
          'Phrase : « Pierre prépare rapidement trois remarques claires. »',
        ],
        checkpoint: 'Mon /ʁ/ reste audible dans une phrase rapide sans raclement ni effort douloureux.',
      },
      {
        id: 'finales',
        title: 'Consonnes finales : prononcer selon le mot, pas selon la lettre',
        objective: 'Réduire les consonnes ajoutées ou supprimées par simple lecture orthographique.',
        principles: [
          'De nombreuses consonnes écrites en finale sont muettes, mais les exceptions sont nombreuses et lexicales.',
          'Une consonne finale peut réapparaître en liaison dans certains contextes.',
          'Il faut mémoriser la forme sonore du mot avec son usage, pas appliquer une règle unique à toutes les finales.',
        ],
        drills: [
          'Comparer des familles : « petit / petite », « grand / grande », « long / longue ».',
          'Lire une liste de mots connus et marquer au crayon uniquement les consonnes réellement prononcées.',
          'Phrase : « Un grand projet peut devenir très concret. »',
        ],
        checkpoint: 'Je peux justifier mes consonnes finales par la prononciation du mot et le contexte, pas seulement par l’orthographe.',
      },
    ],
  },
  {
    id: 'chaine-parlee',
    level: 'B1 → B2',
    title: 'Construire une chaîne parlée naturelle',
    summary: 'Enchaînement, liaison, élision et regroupement des mots dans la parole continue.',
    lessons: [
      {
        id: 'enchainement',
        title: 'Enchaînement consonantique',
        objective: 'Lier une consonne déjà prononcée à la voyelle du mot suivant sans pause parasite.',
        principles: [
          'Dans « avec elle », le /k/ appartient au premier mot mais se rattache perceptivement à la syllabe suivante.',
          'L’enchaînement conserve la consonne : il ne crée pas un nouveau son.',
          'Une parole liée améliore le rythme et réduit l’impression de lecture mot à mot.',
        ],
        drills: [
          'Lire en continu : « avec‿elle », « pour‿eux », « cette‿année », « il‿arrive ».',
          'Tracer des arcs entre les mots qui doivent rester liés dans une phrase.',
          'Lire une fois mot à mot, puis une fois avec enchaînements et comparer l’effort.',
        ],
        checkpoint: 'Je peux enchaîner sans avaler la consonne ni ajouter une pause entre les mots.',
      },
      {
        id: 'liaison',
        title: 'Liaison : obligatoire, interdite ou variable',
        objective: 'Éviter à la fois l’absence de liaisons structurantes et les liaisons hypercorrectes.',
        principles: [
          'Certaines liaisons sont fortement attendues, notamment dans plusieurs groupes déterminant + nom/adjectif et pronom + verbe.',
          'D’autres sont interdites, par exemple après « et » dans l’usage standard.',
          'Beaucoup sont variables selon le registre : mieux vaut apprendre les contextes par groupes plutôt qu’une liste de lettres finales.',
        ],
        drills: [
          'Marquer : « les‿enfants », « vous‿avez », « un grand‿ami » ; puis comparer avec « et elle » sans liaison.',
          'Lire un paragraphe et classer les liaisons en trois colonnes : attendue, variable, à éviter.',
          'Refaire le texte à débit naturel en ne produisant que les liaisons réellement choisies.',
        ],
        checkpoint: 'Je n’ajoute plus automatiquement une liaison dès qu’un mot finit par une consonne écrite.',
      },
      {
        id: 'elision-fluidite',
        title: 'Élision, contractions et fluidité',
        objective: 'Prononcer les formes fréquentes sans rigidité graphique.',
        principles: [
          'L’écrit montre certaines élisions (« l’ami », « j’arrive »), mais l’oral courant comporte aussi des réductions qui dépendent du registre.',
          'En lecture soignée, on recherche d’abord la continuité et la clarté, pas une imitation forcée de la conversation familière.',
          'Le bon niveau de réduction dépend du public, du texte et de l’intention.',
        ],
        drills: [
          'Lire « j’ai », « l’histoire », « qu’il arrive », « d’accord » comme unités fluides.',
          'Comparer une lecture très articulée et une lecture conversationnelle du même passage.',
          'Choisir consciemment un registre : cours, exposé, récit ou conversation.',
        ],
        checkpoint: 'Je peux adapter le degré de réduction sans rendre le texte ni raide ni relâché.',
      },
    ],
  },
  {
    id: 'prosodie',
    level: 'B1 → C1',
    title: 'Rythme, accent et intonation',
    summary: 'Faire entendre la structure et l’intention du message, au-delà de la simple correction des sons.',
    lessons: [
      {
        id: 'groupes-rythmiques',
        title: 'Découper le sens en groupes rythmiques',
        objective: 'Faire correspondre respiration, syntaxe et sens.',
        principles: [
          'Un groupe rythmique doit rester assez court pour être produit sur un souffle confortable.',
          'Les coupures se placent de préférence aux frontières syntaxiques et sémantiques.',
          'Une pause mal placée peut brouiller le sens même si tous les sons sont correctement prononcés.',
        ],
        drills: [
          'Prendre un paragraphe et marquer les groupes avec « / » avant de lire.',
          'Interdire toute respiration à l’intérieur d’un groupe court.',
          'Reformuler le même passage avec des groupes plus longs puis plus courts et comparer la clarté.',
        ],
        checkpoint: 'Mes pauses aident l’auditeur à anticiper la structure de la phrase.',
      },
      {
        id: 'accent-focus',
        title: 'Accent de groupe et mise en relief',
        objective: 'Hiérarchiser l’information sans marteler chaque mot important.',
        principles: [
          'L’accent principal se place normalement vers la fin du groupe rythmique.',
          'Une mise en relief volontaire peut déplacer ou renforcer un accent pour créer un contraste.',
          'Le contraste efficace combine durée, hauteur et énergie sans nécessairement parler plus fort.',
        ],
        drills: [
          'Dire « Je veux le dossier ROUGE » puis « JE veux le dossier rouge » et expliquer le changement de sens.',
          'Souligner un seul mot focal par groupe dans un texte d’enseignement.',
          'Reprendre le texte en réduisant les accents secondaires inutiles.',
        ],
        checkpoint: 'Un auditeur peut identifier l’information nouvelle ou contrastée sans voir mon texte.',
      },
      {
        id: 'intonation',
        title: 'Intonation : continuer, conclure, questionner',
        objective: 'Utiliser la mélodie de la phrase pour guider l’écoute.',
        principles: [
          'L’intonation organise la continuité, la clôture et de nombreuses nuances pragmatiques.',
          'Une montée ou une descente ne se résume pas à la dernière syllabe : elle se prépare dans le groupe.',
          'Une lecture entièrement plate fatigue l’auditeur ; une mélodie excessive détourne du contenu.',
        ],
        drills: [
          'Dire la même phrase comme affirmation, question de confirmation puis énumération non terminée.',
          'Tracer une flèche mélodique au-dessus de trois groupes avant de les lire.',
          'Enregistrer 30 secondes et repérer les fins de groupes toutes identiques.',
        ],
        checkpoint: 'Mes fins de groupes signalent clairement si l’idée continue ou se termine.',
      },
    ],
  },
  {
    id: 'lecture-publique',
    level: 'B2 → Maîtrise',
    title: 'Lire et enseigner avec présence',
    summary: 'Diction, projection, intention, pédagogie orale et autonomie de correction.',
    lessons: [
      {
        id: 'diction-projection',
        title: 'Diction et projection sans surarticulation',
        objective: 'Être compris dans une pièce ou devant un groupe sans durcir la parole.',
        principles: [
          'La précision vient d’attaques consonantiques propres et de voyelles stables, pas d’une ouverture maximale de la bouche.',
          'La projection associe souffle, résonance, posture et direction de la parole.',
          'Une diction pédagogique doit rester naturelle : les mots-outils peuvent être plus légers que les notions clés.',
        ],
        drills: [
          'Lire vers un point situé au fond de la pièce sans augmenter la hauteur de voix.',
          'Articuler une phrase très lentement, puis conserver seulement 30 % de cette exagération.',
          'Alterner une phrase explicative et une phrase de consigne en changeant l’énergie, pas le volume maximal.',
        ],
        checkpoint: 'Ma voix porte sans douleur et reste intelligible lorsque je reviens à un débit naturel.',
      },
      {
        id: 'partition-texte',
        title: 'Préparer une partition de lecture',
        objective: 'Transformer un texte écrit en plan de performance orale.',
        principles: [
          'Une partition marque les groupes, respirations, mots focaux, changements d’intention et ralentissements utiles.',
          'Préparer ces choix avant la lecture libère l’attention pendant la prise de parole.',
          'La partition doit rester légère : trop de signes empêchent de regarder le public.',
        ],
        drills: [
          'Sur 120 mots, marquer « / » pour les groupes, souligner les mots focaux et entourer deux respirations indispensables.',
          'Lire une première fois avec le texte, puis une deuxième fois en levant les yeux à chaque fin de groupe.',
          'Supprimer la moitié des marques qui n’ont finalement aucune utilité audible.',
        ],
        checkpoint: 'Je peux expliquer chaque marque de ma partition par une intention de sens ou de respiration.',
      },
      {
        id: 'lecture-expressive',
        title: 'Lecture expressive sans théâtralisation automatique',
        objective: 'Faire varier débit, énergie, pauses et intonation au service du texte.',
        principles: [
          'L’expression vient d’abord de la compréhension : ce qui est nouveau, opposé, important ou émotionnel guide la voix.',
          'Ralentir partout annule l’effet du ralentissement ; accentuer partout annule l’effet de l’accent.',
          'Une variation pertinente vaut mieux qu’une mélodie décorative ajoutée au texte.',
        ],
        drills: [
          'Choisir un paragraphe narratif et identifier trois changements d’intention.',
          'Lire une version volontairement neutre, puis une version expressive, puis chercher un équilibre crédible.',
          'Demander à un auditeur de résumer ce qu’il a perçu comme essentiel.',
        ],
        checkpoint: 'Mes variations vocales correspondent à la structure du texte et non à une recette répétitive.',
      },
      {
        id: 'enseigner-oralement',
        title: 'Expliquer et capter l’attention',
        objective: 'Utiliser la voix pour rendre un enseignement clair, mémorisable et vivant.',
        principles: [
          'Une explication orale efficace alterne annonce, développement, exemple et synthèse.',
          'Une courte pause avant une idée importante augmente souvent son impact plus qu’un volume supérieur.',
          'Changer légèrement le rythme ou l’intonation lors d’un exemple aide l’auditeur à distinguer structure et illustration.',
        ],
        drills: [
          'Préparer une explication de 60 secondes avec une phrase d’ouverture, trois idées et une conclusion.',
          'Placer une pause avant chaque terme que le public doit retenir.',
          'Refaire l’explication en supprimant les mots de remplissage et les accélérations de fin de phrase.',
        ],
        checkpoint: 'Un auditeur peut restituer la structure de mon explication après une seule écoute.',
      },
      {
        id: 'evaluation-maitrise',
        title: 'Épreuve de maîtrise et boucle de correction',
        objective: 'Devenir autonome : diagnostiquer, corriger et stabiliser sa propre lecture.',
        principles: [
          'Évaluer séparément articulation, fluidité, prosodie, souffle, intelligibilité et impact évite les jugements vagues.',
          'Une séance efficace corrige un ou deux paramètres à la fois, puis vérifie leur maintien dans un texte nouveau.',
          'La maîtrise se mesure au transfert : rester clair et expressif sans préparer chaque phrase en détail.',
        ],
        drills: [
          'Enregistrer 2 minutes d’un texte inconnu après 3 minutes de préparation seulement.',
          'Noter de 1 à 5 : sons, liaisons/enchaînements, rythme, intonation, souffle, présence.',
          'Choisir le score le plus faible, travailler 10 minutes, puis refaire un extrait différent.',
        ],
        checkpoint: 'Je peux identifier mon principal point faible, choisir un exercice adapté et constater une amélioration sur un nouveau texte.',
      },
    ],
  },
];

const allLessons = modules.flatMap(module => module.lessons.map(lesson => ({ ...lesson, moduleId: module.id })));

export function PronunciationCourse({ completed, onCompletedChange, storageWarning = '', onClose }: Props) {
  const [selectedId, setSelectedId] = useState(allLessons[0]?.id ?? '');
  const selected = allLessons.find(lesson => lesson.id === selectedId) ?? allLessons[0];
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const completedCount = allLessons.filter(lesson => completedSet.has(lesson.id)).length;
  const progress = allLessons.length ? Math.round((completedCount / allLessons.length) * 100) : 0;

  const toggleCompleted = (lessonId: string) => {
    const next = new Set(completedSet);
    if (next.has(lessonId)) next.delete(lessonId);
    else next.add(lessonId);
    onCompletedChange(allLessons.map(lesson => lesson.id).filter(id => next.has(id)));
  };

  return <section className="pronunciation-overlay" role="dialog" aria-modal="true" aria-label="Cursus de lecture et prononciation française">
    <div className="pronunciation-shell">
      <header className="pronunciation-header">
        <div>
          <p className="eyebrow">SIRĀFIQ · LECTURE & VOIX</p>
          <h1>Lire, prononcer, transmettre</h1>
          <p>Un parcours progressif de l’articulation jusqu’à la lecture publique et à l’enseignement oral. La cible est l’intelligibilité, la précision et la maîtrise prosodique — pas l’effacement d’un accent personnel.</p>
        </div>
        <button type="button" onClick={onClose}>Fermer</button>
      </header>

      <div className="pronunciation-progress" aria-label={`${completedCount} leçons terminées sur ${allLessons.length}`}>
        <div><strong>{progress} %</strong><span>{completedCount} / {allLessons.length} leçons</span></div>
        <progress value={completedCount} max={allLessons.length} />
      </div>

      {storageWarning && <p className="pronunciation-warning" role="alert">{storageWarning}</p>}

      <div className="pronunciation-layout">
        <nav className="pronunciation-nav" aria-label="Modules du cursus">
          {modules.map(module => {
            const moduleDone = module.lessons.filter(lesson => completedSet.has(lesson.id)).length;
            return <section key={module.id}>
              <div className="pronunciation-module-title"><div><small>{module.level}</small><strong>{module.title}</strong></div><span>{moduleDone}/{module.lessons.length}</span></div>
              <p>{module.summary}</p>
              <div className="pronunciation-lessons">{module.lessons.map(lesson => <button key={lesson.id} type="button" className={selectedId === lesson.id ? 'active' : ''} onClick={() => setSelectedId(lesson.id)}><span>{completedSet.has(lesson.id) ? '✓' : '○'}</span>{lesson.title}</button>)}</div>
            </section>;
          })}
        </nav>

        {selected && <article className="pronunciation-lesson">
          <div className="pronunciation-lesson-heading">
            <div><p className="eyebrow">LEÇON</p><h2>{selected.title}</h2><p>{selected.objective}</p></div>
            <button type="button" className={completedSet.has(selected.id) ? 'completed' : ''} onClick={() => toggleCompleted(selected.id)}>{completedSet.has(selected.id) ? '✓ Terminée' : 'Marquer comme terminée'}</button>
          </div>

          <section>
            <h3>Repères techniques</h3>
            <ul>{selected.principles.map(point => <li key={point}>{point}</li>)}</ul>
          </section>

          <section>
            <h3>Entraînement</h3>
            <ol>{selected.drills.map(drill => <li key={drill}>{drill}</li>)}</ol>
          </section>

          <section className="pronunciation-checkpoint">
            <h3>Critère de passage</h3>
            <p>{selected.checkpoint}</p>
          </section>
        </article>}
      </div>
    </div>
  </section>;
}
