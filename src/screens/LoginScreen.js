import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebase';
import { appTheme, componentMetrics } from '../theme/tokens';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hasAccount, setHasAccount] = useState(true);

  const submitCredentials = async () => {
    try {
      if (hasAccount) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      Alert.alert('Authentication Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerText}>{hasAccount ? 'Login to HFXParkAid' : 'Sign Up'}</Text>

      <TextInput
        style={styles.inputField}
        placeholder="Email"
        placeholderTextColor={appTheme.color.textSecondary}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.inputField}
        placeholder="Password"
        placeholderTextColor={appTheme.color.textSecondary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity style={styles.actionBtn} onPress={submitCredentials}>
        <Text style={styles.btnText}>{hasAccount ? 'Log In' : 'Sign Up'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setHasAccount(!hasAccount)} style={styles.switchModeBtn}>
        <Text style={styles.switchModeText}>
          {hasAccount ? 'Need an account? Sign Up' : 'Have an account? Log In'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: componentMetrics.horizontalPadding,
    backgroundColor: appTheme.color.bgCanvas,
  },
  headerText: {
    fontSize: appTheme.typography.size.xxl,
    fontWeight: 'bold',
    marginBottom: appTheme.spacing.xl,
    textAlign: 'center',
    color: appTheme.color.brandGold,
  },
  inputField: {
    borderWidth: 1,
    borderColor: appTheme.color.brandGold,
    padding: appTheme.spacing.sm,
    marginBottom: appTheme.spacing.md,
    borderRadius: appTheme.radius.sm,
    color: appTheme.color.textPrimary,
    backgroundColor: appTheme.color.bgSurface,
    fontSize: appTheme.typography.size.md,
  },
  actionBtn: {
    backgroundColor: appTheme.color.brandGold,
    padding: appTheme.spacing.md,
    borderRadius: appTheme.radius.sm,
    alignItems: 'center',
    marginBottom: appTheme.spacing.md,
  },
  btnText: {
    color: appTheme.color.bgCanvas,
    fontWeight: 'bold',
    fontSize: appTheme.typography.size.md,
  },
  switchModeBtn: {
    alignItems: 'center',
  },
  switchModeText: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
  },
});
