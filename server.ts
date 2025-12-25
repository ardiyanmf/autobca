import express, { Request, Response } from 'express';
import { BCAService } from './bca.service';

const app = express();
app.use(express.json());

app.post('/api/cek-saldo', async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ status: false, message: "Input required" });

    const bca = new BCAService();
    try {
        const data = await bca.getBalance(username, password);
        res.json({ status: true, data });
    } catch (error: any) {
        res.status(500).json({ status: false, message: error.message });
    }
});

app.post('/api/mutasi', async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ status: false, message: "Input required" });

    const bca = new BCAService();
    try {
        const data = await bca.getHistory(username, password);
        res.json({ status: true, data });
    } catch (error: any) {
        res.status(500).json({ status: false, message: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`BCA API running on http://localhost:${PORT}`));