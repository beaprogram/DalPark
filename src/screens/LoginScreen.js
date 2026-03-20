import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, Alert, TouchableOpacity, Image } from 'react-native';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebase';
import { DalTheme } from '../utils/theme';

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
        placeholderTextColor={DalTheme.fadedGrey}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.inputField}
        placeholder="Password"
        placeholderTextColor={DalTheme.fadedGrey}
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
    padding: 20, 
    backgroundColor: DalTheme.blackBg 
  },
  logo: {
    width: '100%',
    height: 80,
    marginBottom: 20,
    alignSelf: 'center'
  },
  headerText: { 
    fontSize: 28, 
    fontWeight: 'bold', 
    marginBottom: 30, 
    textAlign: 'center', 
    color: DalTheme.dalGold 
  },
  inputField: { 
    borderWidth: 1, 
    borderColor: DalTheme.dalGold, 
    padding: 12, 
    marginBottom: 15, 
    borderRadius: 8, 
    color: DalTheme.whiteText,
    backgroundColor: DalTheme.inputBox
  },
  actionBtn: {
    backgroundColor: DalTheme.dalGold,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15
  },
  btnText: { 
    color: DalTheme.blackBg, 
    fontWeight: 'bold', 
    fontSize: 16 
  },
  switchModeBtn: { 
    alignItems: 'center' 
  },
  switchModeText: { 
    color: DalTheme.whiteText, 
    fontSize: 14 
  }
});