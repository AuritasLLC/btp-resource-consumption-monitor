
const cds = require('@sap/eslint-plugin-cds')

module.exports = [
  cds.configs.recommended,
  {
    plugins: {
      "@sap/cds": cds
    },
    "files": [
      ...cds.configs.recommended.files
    ],
    "rules": {
      ...cds.configs.recommended.rules
    }
  },
  {
    // Logging whole objects can leak credentials (e.g. a destination payload carrying a clientSecret):
    // log calls may only take a single message argument; interpolate the specific safe fields instead
    "files": ["srv/**/*.ts"],
    "ignores": ["srv/external/**"],
    "languageOptions": {
      "parser": require('@typescript-eslint/parser')
    },
    "rules": {
      "no-restricted-syntax": ["error",
        {
          "selector": "CallExpression[callee.type='Identifier'][callee.name=/^(trace|debug|log|info|warn|error)$/][arguments.length>1]",
          "message": "Do not pass objects to the logger. Log a single message and interpolate only non-sensitive fields."
        },
        {
          "selector": "CallExpression[callee.property.name=/^(trace|debug|log|info|warn|error)$/][callee.object.name=/^(console|LOG|log|logger)$/][arguments.length>1]",
          "message": "Do not pass objects to the logger. Log a single message and interpolate only non-sensitive fields."
        }
      ]
    }
  }
]
