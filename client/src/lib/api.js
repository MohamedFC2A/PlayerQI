import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
});

export const sendGameMove = async (history, rejectedGuesses = []) => {
    try {
        const response = await api.post('/game', { history, rejectedGuesses });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};

export const sendGuessConfirmation = async ({ history, guess, correct }) => {
    try {
        const response = await api.post('/confirm', { history, guess, correct });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};

export const finalizeGuessConfirmation = async ({ history, guess }) => {
    try {
        const response = await api.post('/confirm-final', { history, guess });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};
