prerequisite: node.js installed

Pull the code from repo
run 'npm install'
run the app using 'npx expo start -c'

Map screen now uses AsyncStorage to persist:
- last viewed map region
- search text
- lot list visibility
- selected parking lot id

Map screen now reads parking lots from Firestore collection `lots`.
If `lots` is empty or unavailable, app falls back to local `src/data/parkingLots.js`.

Minimum lot document shape (doc id is lot id):
```json
{
  "name": "Dalplex",
  "campus": "studley",
  "address": "6260 South Street, Halifax, NS",
  "coordinate": { "latitude": 44.63397, "longitude": -63.5925 },
  "navigationCoordinate": { "latitude": 44.63397, "longitude": -63.5925 },
  "generalSpaces": 116,
  "reservedSpaces": 0,
  "shortTermSpaces": 31,
  "eveningGeneralSpaces": 147,
  "eveningShortTermSpaces": 0,
  "lastStatus": "UNKNOWN",
  "statusConfidence": "LOW",
  "lastStatusAt": 1741488000000
}
```
