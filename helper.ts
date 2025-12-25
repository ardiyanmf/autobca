export const cleanAmount = (input: string): number => {
    return parseFloat(input.replace(/[^0-9.]/g, ''));
};

export const delay = (ms: number) => new Promise(res => setTimeout(res, ms));