#!/bin/bash

# Script pour générer automatiquement le coverage avec Jest
# Auteur: DeepSeek CLI
# Date: $(date)

echo "🧪 Génération du coverage avec Jest..."

# Vérifier si node_modules existe
if [ ! -d "node_modules" ]; then
    echo "📦 Installation des dépendances..."
    npm install
fi

# Exécuter les tests avec coverage
echo "🚀 Lancement des tests avec coverage..."
npm run test:coverage

# Vérifier si le coverage a été généré
if [ -d "coverage" ]; then
    echo "✅ Coverage généré avec succès!"
    echo "📊 Rapport disponible dans: coverage/lcov-report/index.html"
    
    # Afficher un résumé des fichiers couverts
    echo ""
    echo "📈 Résumé de la couverture:"
    grep -A 5 "All files" coverage/lcov-report/index.html | sed 's/<[^>]*>//g' | tr -s ' ' | sed 's/^ *//'
else
    echo "❌ Erreur: Le coverage n'a pas été généré"
    exit 1
fi

echo ""
echo "🌐 Pour visualiser le rapport détaillé:"
echo "   Ouvrez le fichier: coverage/lcov-report/index.html dans votre navigateur"
