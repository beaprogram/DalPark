import React, { useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { collection, addDoc } from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import { appTheme, componentMetrics } from '../../theme/tokens';
import PrimaryButton from '../common/PrimaryButton';

const MOOD_FACES = ['😡', '😟', '😐', '🙂', '😁'];

export default function ReportModal({ visible, lot, onClose, onReported }) {
    const [pick, setPick] = useState(3);
    const [photo, setPhoto] = useState(null);
    const [sending, setSending] = useState(false);

    const snapPhoto = async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
            Alert.alert('Permission Needed', 'Camera access is needed to snap a photo.');
            return;
        }
        const shot = await ImagePicker.launchCameraAsync({
            quality: 0.5,
            base64: true,
            allowsEditing: false,
        });
        if (!shot.canceled && shot.assets?.[0]) {
            setPhoto(shot.assets[0].uri);
        }
    };

    const fromGallery = async () => {
        const picked = await ImagePicker.launchImageLibraryAsync({
            quality: 0.5,
            base64: true,
            allowsEditing: false,
        });
        if (!picked.canceled && picked.assets?.[0]) {
            setPhoto(picked.assets[0].uri);
        }
    };

    const send = async () => {
        if (!lot || !auth.currentUser) return;
        setSending(true);
        try {
            const entry = {
                lotId: lot.id,
                lotName: lot.name,
                userId: auth.currentUser.uid,
                userEmail: auth.currentUser.email,
                rating: pick,
                imgUri: photo || null,
                createdAt: Date.now(),
            };
            await addDoc(collection(db, 'reports'), entry);
            Alert.alert('Thanks!', 'Report submitted.');
            setPick(3);
            setPhoto(null);
            if (onReported) onReported(entry);
            onClose();
        } catch (_e) {
            Alert.alert('Oops', 'Could not save. Try again.');
        } finally {
            setSending(false);
        }
    };

    const dismiss = () => {
        setPick(3);
        setPhoto(null);
        onClose();
    };

    return (
        <Modal animationType="slide" transparent visible={visible} onRequestClose={dismiss}>
            <View style={s.overlay}>
                <View style={s.card}>
                    <Text style={s.title}>Report: {lot?.name}</Text>
                    <Text style={s.lbl}>How busy is this lot?</Text>
                    <View style={s.pickRow}>
                        {MOOD_FACES.map((face, i) => (
                            <Pressable
                                key={i}
                                onPress={() => setPick(i + 1)}
                                style={[s.dot, pick === i + 1 && s.dotOn]}
                            >
                                <Text style={s.faceTxt}>{face}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <View style={s.pickLabels}>
                        <Text style={s.pickHint}>Full</Text>
                        <Text style={s.pickHint}>Empty</Text>
                    </View>
                    <Text style={s.lbl}>Attach Photo (optional)</Text>
                    <View style={s.imgBtns}>
                        <Pressable onPress={snapPhoto} style={s.imgBtn}>
                            <Text style={s.imgBtnTxt}>Using Camera</Text>
                        </Pressable>
                        <Pressable onPress={fromGallery} style={s.imgBtn}>
                            <Text style={s.imgBtnTxt}>From Gallery</Text>
                        </Pressable>
                    </View>
                    {photo && <Image source={{ uri: photo }} style={s.preview} />}
                    <View style={s.actions}>
                        <Pressable onPress={dismiss} style={s.cancelBtn}>
                            <Text style={s.cancelTxt}>Cancel</Text>
                        </Pressable>
                        <PrimaryButton
                            label="Submit"
                            onPress={send}
                            loading={sending}
                            style={{ flex: 1 }}
                        />
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    card: {
        backgroundColor: appTheme.color.bgElevated,
        borderTopLeftRadius: appTheme.radius.xl,
        borderTopRightRadius: appTheme.radius.xl,
        padding: componentMetrics.horizontalPadding,
        paddingBottom: componentMetrics.bottomSafePadding + 20,
    },
    title: {
        color: appTheme.color.textPrimary,
        fontSize: appTheme.typography.size.lg,
        fontWeight: '700',
        marginBottom: appTheme.spacing.md,
    },
    lbl: {
        color: appTheme.color.textSecondary,
        fontSize: appTheme.typography.size.sm,
        marginBottom: appTheme.spacing.xs,
        marginTop: appTheme.spacing.sm,
    },
    pickRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: appTheme.spacing.xs,
    },
    dot: {
        flex: 1,
        height: 44,
        borderRadius: appTheme.radius.md,
        backgroundColor: appTheme.color.bgSurface,
        borderWidth: 1,
        borderColor: appTheme.color.borderDefault,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dotOn: {
        backgroundColor: appTheme.color.brandGold,
        borderColor: appTheme.color.brandGold,
    },
    faceTxt: {
        fontSize: 22,
    },
    pickLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    pickHint: {
        color: appTheme.color.textSecondary,
        fontSize: 11,
    },
    imgBtns: {
        flexDirection: 'row',
        gap: appTheme.spacing.sm,
    },
    imgBtn: {
        flex: 1,
        height: 44,
        borderRadius: appTheme.radius.md,
        backgroundColor: appTheme.color.bgSurface,
        borderWidth: 1,
        borderColor: appTheme.color.borderDefault,
        alignItems: 'center',
        justifyContent: 'center',
    },
    imgBtnTxt: {
        color: appTheme.color.textPrimary,
        fontSize: appTheme.typography.size.sm,
    },
    preview: {
        width: '100%',
        height: 150,
        borderRadius: appTheme.radius.md,
        marginTop: appTheme.spacing.sm,
    },
    actions: {
        flexDirection: 'row',
        gap: appTheme.spacing.sm,
        marginTop: appTheme.spacing.lg,
        alignItems: 'center',
    },
    cancelBtn: {
        height: componentMetrics.primaryButtonHeight,
        paddingHorizontal: appTheme.spacing.lg,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: appTheme.radius.md,
        borderWidth: 1,
        borderColor: appTheme.color.borderDefault,
        backgroundColor: appTheme.color.bgSurface,
    },
    cancelTxt: {
        color: appTheme.color.textPrimary,
        fontSize: appTheme.typography.size.sm,
        fontWeight: '600',
    },
});
