import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import categoryRoutes from './routes/categories.js';
import uploadRoutes from './routes/upload.js';
import commentRoutes from './routes/comments.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ===============================
// Rate Limiter
// ===============================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        success: false,
        message: 'Too many requests, please try again later.'
    }
});

// ===============================
// Middleware
// ===============================
app.use(helmet());
app.use(morgan('dev'));
app.use(limiter);

app.use(
    cors({
        origin: [
            process.env.FRONTEND_URL || 'http://localhost:5173',
            process.env.ADMIN_URL || 'http://localhost:5174',
            'https://devzore.com',
            'https://www.devzore.com'
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
    })
);

app.use(express.json({ limit: '10mb' }));

app.use(
    express.urlencoded({
        extended: true,
        limit: '10mb'
    })
);

// ===============================
// API Routes
// ===============================
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/comments', commentRoutes);

// ===============================
// Home Route
// ===============================
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'DevZore Blog API is running ✅',
        version: '1.0.0',
        endpoints: [
            '/api/auth',
            '/api/posts',
            '/api/categories',
            '/api/upload',
            '/api/comments'
        ]
    });
});

// ===============================
// Health Check
// ===============================
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString()
    });
});

// ===============================
// 404 Handler
// ===============================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.originalUrl} not found`
    });
});

// ===============================
// Error Handler
// ===============================
app.use((err, req, res, next) => {
    console.error('Error:', err.message);

    res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
});

// ===============================
// MongoDB Connection
// ===============================
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('✅ MongoDB Connected');

        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ MongoDB Connection Failed:', err.message);
        process.exit(1);
    }
};

// Start Server
connectDB();