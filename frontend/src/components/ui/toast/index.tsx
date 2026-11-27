import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import clsx from 'clsx';
import Icon, { CheckIcon, CloseIcon, PauseIcon, WarningIcon } from '@components/ui/icon';
import { Tones, type Tone } from '@constants/tones';
import { useSound } from '@contexts/sound';
import styles from './index.module.css';
import RoundKey from '@components/ui/round-key';

export type ToastTone = 'error' | 'info' | 'success';

export type ToastInput = {
    message: string;
    tone?: ToastTone;
};

type ToastRecord = ToastInput & {
    id: string;
};

type ToastContextValue = {
    show: (input: ToastInput) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    success: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5200;

const toneIcon = (tone: ToastTone) => {
    if (tone === 'success') return CheckIcon;
    if (tone === 'info') return PauseIcon;
    return tone === 'error' ? CloseIcon : WarningIcon;
};

const toneColor = (tone: ToastTone): Exclude<Tone, 'azure'> => {
    if (tone === 'success') return Tones.Emerald;
    if (tone === 'info') return Tones.Inherit;
    return Tones.Magenta;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastRecord[]>([]);
    const { play } = useSound();

    const dismiss = useCallback((id: string) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    const show = useCallback(
        ({ message, tone = 'error' }: ToastInput) => {
            const id = crypto.randomUUID();
            setToasts((current) => [...current, { id, message, tone }]);
            window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
            // Info toasts stay quiet: they report progress, not an outcome worth a cue.
            if (tone !== 'info') play(tone);
        },
        [dismiss, play],
    );

    const value = useMemo<ToastContextValue>(
        () => ({
            show,
            error: (message) => show({ message, tone: 'error' }),
            info: (message) => show({ message, tone: 'info' }),
            success: (message) => show({ message, tone: 'success' }),
        }),
        [show],
    );

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className={styles.viewport} aria-live="polite" aria-relevant="additions">
                {toasts.map((toast) => {
                    const tone = toast.tone ?? 'error';
                    const IconComponent = toneIcon(tone);
                    return (
                        <div key={toast.id} className={clsx(styles.toast, styles[tone])} role="status">
                            <span className={styles.icon} aria-hidden>
                                <Icon as={IconComponent} tone={toneColor(tone)} />
                            </span>
                            <p className={styles.message}>{toast.message}</p>
                            <RoundKey
                                icon="close"
                                size="sm"
                                aria-label="Dismiss notification"
                                onClick={() => dismiss(toast.id)}
                            />
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = (): ToastContextValue => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return context;
};
