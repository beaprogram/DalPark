import React from 'react';
import { View, Button } from 'react-native';
import { auth } from '../config/firebase';

export default function SettingsScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Button title="Log Out" onPress={() => auth.signOut()} color="red" />
    </View>
  );
}