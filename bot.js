require('dotenv').config();

// --- Verificación de Variables de Entorno ---
if (!process.env.BOT_TOKEN || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.MONGODB_URI || !process.env.SESSION_SECRET) {
    console.error('❌ ERROR: Faltan variables de entorno requeridas en .env:');
    if (!process.env.BOT_TOKEN) console.error('  - BOT_TOKEN');
    if (!process.env.DISCORD_CLIENT_ID) console.error('  - DISCORD_CLIENT_ID');
    if (!process.env.DISCORD_CLIENT_SECRET) console.error('  - DISCORD_CLIENT_SECRET');
    if (!process.env.MONGODB_URI) console.error('  - MONGODB_URI');
    if (!process.env.SESSION_SECRET) console.error('  - SESSION_SECRET');
    process.exit(1);
}

// --- Módulos Requeridos ---
const Discord = require('discord.js');
const fs = require('fs'); // Aunque no se usa directamente para JSON, se mantiene por si acaso
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

// --- Datos del Bot (ahora gestionados por MongoDB) ---
let userData = {};
let teams = {};
let matches = {};
let bets = {};
let matchResults = {};
let bettingPaused = false; // Estado de las apuestas

// --- Lista de IDs de administradores (se puede hacer persistente si es necesario) ---
const adminIds = ['438147217702780939']; // Tu ID de Discord

function isAdmin(userId) {
    return adminIds.includes(userId);
}

// --- Esquemas de MongoDB ---
const userSchema = new mongoose.Schema({
    _id: String, // Discord User ID
    username: String,
    discriminator: String,
    avatar: String,
    balance: { type: Number, default: 1000 },
    totalBets: { type: Number, default: 0 },
    wonBets: { type: Number, default: 0 },
    lostBets: { type: Number, default: 0 },
    totalWinnings: { type: Number, default: 0 }
});

const teamSchema = new mongoose.Schema({
    _id: String, // Full team name (e.g., "Team Name (D1)")
    position: Number,
    lastFiveMatches: String,
    league: String,
    tournament: String,
    originalName: String,
    realStats: { // Estadísticas reales obtenidas del scraping de resultados
        matches: Number,
        wins: Number,
        draws: Number,
        losses: Number,
        goalsFor: Number,
        goalsAgainst: Number,
        goalDifference: Number,
        averageGoalsFor: String,
        averageGoalsAgainst: String,
        winRate: String,
        lastUpdated: String
    }
});

const matchSchema = new mongoose.Schema({
    _id: String, // matchId
    team1: String,
    team2: String,
    odds: {
        team1: Number,
        draw: Number,
        team2: Number
    },
    matchTime: String,
    status: String, // 'upcoming', 'finished'
    result: String, // 'team1', 'draw', 'team2'
    score: String,  // 'X-Y'
    bets: [String], // Array de betIds
    isCustom: Boolean,
    tournament: String
});

const betSchema = new mongoose.Schema({
    _id: String, // betId
    userId: String,
    matchId: String,
    prediction: String, // For simple bets: 'team1', 'draw', 'team2'
    amount: Number,
    odds: Number,
    status: String, // 'pending', 'won', 'lost'
    timestamp: String,
    betType: String, // 'simple', 'exact_score', 'special', 'special_combined'
    description: String, // Human-readable description of the bet
    exactScore: { // For exact_score bets
        home: Number,
        away: Number
    },
    specialType: String, // For single special bets (e.g., 'both_teams_score')
    specialBets: [mongoose.Schema.Types.Mixed] // For combined special bets (array of {type, name, odds})
});

const matchResultSchema = new mongoose.Schema({
    _id: String, // matchId
    result: String,
    score: String,
    timestamp: String,
    isManual: Boolean,
    setBy: String, // User ID who set the result manually
    specialResults: mongoose.Schema.Types.Mixed, // { 'corner_goal': true, 'header_goal': true }
    additionalStats: mongoose.Schema.Types.Mixed // { 'Tarjetas Amarillas': 3, 'Córners Totales': 10 }
});

// --- Modelos Mongoose ---
const User = mongoose.model('User', userSchema);
const Team = mongoose.model('Team', teamSchema);
const Match = mongoose.model('Match', matchSchema);
const Bet = mongoose.model('Bet', betSchema);
const MatchResult = mongoose.model('MatchResult', matchResultSchema);

// --- Conexión a MongoDB ---
async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Conectado a MongoDB');
        await loadData(); // Cargar datos después de conectar
    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error);
        process.exit(1);
    }
}

// --- Funciones de Carga y Guardado de Datos (MongoDB) ---
async function loadData() {
    try {
        console.log('📥 Cargando datos desde MongoDB...');
        const users = await User.find({});
        userData = {};
        users.forEach(user => {
            userData[user._id] = {
                username: user.username,
                discriminator: user.discriminator,
                avatar: user.avatar,
                balance: user.balance,
                totalBets: user.totalBets,
                wonBets: user.wonBets,
                lostBets: user.lostBets,
                totalWinnings: user.totalWinnings
            };
        });

        const teamDocs = await Team.find({});
        teams = {};
        teamDocs.forEach(team => {
            teams[team._id] = {
                position: team.position,
                lastFiveMatches: team.lastFiveMatches,
                league: team.league,
                tournament: team.tournament,
                originalName: team.originalName,
                realStats: team.realStats // Cargar estadísticas reales
            };
        });

        const matchDocs = await Match.find({});
        matches = {};
        matchDocs.forEach(match => {
            matches[match._id] = {
                id: match._id,
                team1: match.team1,
                team2: match.team2,
                odds: match.odds,
                matchTime: match.matchTime,
                status: match.status,
                result: match.result,
                score: match.score,
                bets: match.bets,
                isCustom: match.isCustom,
                tournament: match.tournament
            };
        });

        const betDocs = await Bet.find({});
        bets = {};
        betDocs.forEach(bet => {
            bets[bet._id] = {
                id: bet._id,
                userId: bet.userId,
                matchId: bet.matchId,
                prediction: bet.prediction,
                amount: bet.amount,
                odds: bet.odds,
                status: bet.status,
                timestamp: bet.timestamp,
                betType: bet.betType, // Nuevo
                description: bet.description, // Nuevo
                exactScore: bet.exactScore, // Nuevo
                specialType: bet.specialType, // Nuevo
                specialBets: bet.specialBets // Nuevo
            };
        });

        const resultDocs = await MatchResult.find({});
        matchResults = {};
        resultDocs.forEach(result => {
            matchResults[result._id] = {
                result: result.result,
                score: result.score,
                timestamp: result.timestamp,
                isManual: result.isManual,
                setBy: result.setBy,
                specialResults: result.specialResults, // Nuevo
                additionalStats: result.additionalStats // Nuevo
            };
        });

        console.log(`✅ Datos cargados: ${Object.keys(userData).length} usuarios, ${Object.keys(teams).length} equipos, ${Object.keys(matches).length} partidos`);
    } catch (error) {
        console.error('❌ Error cargando datos desde MongoDB:', error);
    }
}

async function saveData() {
    try {
        // Guardar usuarios
        for (const [userId, user] of Object.entries(userData)) {
            await User.findByIdAndUpdate(userId, {
                username: user.username,
                discriminator: user.discriminator,
                avatar: user.avatar,
                balance: user.balance,
                totalBets: user.totalBets,
                wonBets: user.wonBets,
                lostBets: user.lostBets,
                totalWinnings: user.totalWinnings
            }, { upsert: true });
        }

        // Guardar equipos
        for (const [teamName, team] of Object.entries(teams)) {
            await Team.findByIdAndUpdate(teamName, {
                position: team.position,
                lastFiveMatches: team.lastFiveMatches,
                league: team.league,
                tournament: team.tournament,
                originalName: team.originalName,
                realStats: team.realStats
            }, { upsert: true });
        }

        // Guardar partidos
        for (const [matchId, match] of Object.entries(matches)) {
            await Match.findByIdAndUpdate(matchId, {
                team1: match.team1,
                team2: match.team2,
                odds: match.odds,
                matchTime: match.matchTime,
                status: match.status,
                result: match.result,
                score: match.score,
                bets: match.bets,
                isCustom: match.isCustom,
                tournament: match.tournament
            }, { upsert: true });
        }

        // Guardar apuestas
        for (const [betId, bet] of Object.entries(bets)) {
            await Bet.findByIdAndUpdate(betId, {
                userId: bet.userId,
                matchId: bet.matchId,
                prediction: bet.prediction,
                amount: bet.amount,
                odds: bet.odds,
                status: bet.status,
                timestamp: bet.timestamp,
                betType: bet.betType, // Nuevo
                description: bet.description, // Nuevo
                exactScore: bet.exactScore, // Nuevo
                specialType: bet.specialType, // Nuevo
                specialBets: bet.specialBets // Nuevo
            }, { upsert: true });
        }

        // Guardar resultados
        for (const [matchId, result] of Object.entries(matchResults)) {
            await MatchResult.findByIdAndUpdate(matchId, {
                result: result.result,
                score: result.score,
                timestamp: result.timestamp,
                isManual: result.isManual,
                setBy: result.setBy,
                specialResults: result.specialResults, // Nuevo
                additionalStats: result.additionalStats // Nuevo
            }, { upsert: true });
        }

        // console.log('✅ Datos guardados en MongoDB.'); // Descomentar para ver cada guardado
    } catch (error) {
        console.error('❌ Error guardando datos en MongoDB:', error);
    }
}

// --- Inicialización de Usuario (MongoDB) ---
async function initUser(userId, username = null, discriminator = null, avatar = null) {
    try {
        if (!userData[userId]) {
            userData[userId] = {
                balance: 1000,
                totalBets: 0,
                wonBets: 0,
                lostBets: 0,
                totalWinnings: 0,
                username: username || 'Usuario',
                discriminator: discriminator || '0000',
                avatar: avatar || null
            };

            await User.findByIdAndUpdate(userId, { _id: userId, ...userData[userId] }, { upsert: true });
            console.log(`👤 Nuevo usuario creado: ${username || 'Usuario'}`);
        } else {
            let updated = false;
            if (username && userData[userId].username !== username) {
                userData[userId].username = username;
                updated = true;
            }
            if (discriminator && userData[userId].discriminator !== discriminator) {
                userData[userId].discriminator = discriminator;
                updated = true;
            }
            if (avatar && userData[userId].avatar !== avatar) {
                userData[userId].avatar = avatar;
                updated = true;
            }

            if (updated) {
                await User.findByIdAndUpdate(userId, { _id: userId, ...userData[userId] }, { upsert: true });
            }
        }
        return userData[userId];
    } catch (error) {
        console.error('❌ Error inicializando usuario:', error);
        return userData[userId] || { balance: 1000, totalBets: 0, wonBets: 0, lostBets: 0, totalWinnings: 0 };
    }
}

// --- Configuración de Torneos y Ligas ---
const KNOCKOUT_TOURNAMENTS = ['cv', 'izoro', 'izplata', 'cd2', 'cd3'];

const LEAGUE_URLS = {
    d1: 'https://iosoccer-sa.com/torneos/d1',
    d2: 'https://iosoccer-sa.com/torneos/d2',
    d3: 'https://iosoccer-sa.com/torneos/d3',
    maradei: 'https://iosoccer-sa.com/torneos/maradei',
    cv: 'https://iosoccer-sa.com/torneos/cv',
    cd2: 'https://iosoccer-sa.com/torneos/cd2',
    cd3: 'https://iosoccer-sa.com/torneos/cd3',
    izoro: 'https://iosoccer-sa.com/torneos/izoro',
    izplata: 'https://iosoccer-sa.com/torneos/izplata'
};

const TOURNAMENT_NAMES = {
    d1: 'Liga D1',
    d2: 'Liga D2',
    d3: 'Liga D3',
    maradei: 'Copa Maradei',
    cv: 'Copa ValencARc',
    cd2: 'Copa D2',
    cd3: 'Copa D3',
    izoro: 'Copa Intrazonal de Oro',
    izplata: 'Copa Intrazonal de Plata'
};

// --- Funciones de Cálculo de Cuotas ---
function calculateOdds(team1, team2, tournament = null) {
    const t1 = teams[team1], t2 = teams[team2];
    if (!t1 || !t2) return { team1: 2.0, draw: 3.0, team2: 2.0 };

    const t1League = t1.league || (team1.includes('(D1)') ? 'D1' : 'D2');
    const t2League = t2.league || (team2.includes('(D2)') ? 'D2' : 'D1');
    const t1Position = t1.position || 10;
    const t2Position = t2.position || 10;

    if (tournament && KNOCKOUT_TOURNAMENTS.includes(tournament)) {
        return calculateCupOdds(t1, t2, t1League, t2League, t1Position, t2Position, tournament);
    }

    let t1BaseStrength = calculateNewTeamStrength(t1, t1League, t1Position);
    let t2BaseStrength = calculateNewTeamStrength(t2, t2League, t2Position);

    if (t1League !== t2League) {
        const { t1Multiplier, t2Multiplier } = calculateExtremeInterLeagueMultipliers(
            t1League, t1Position, t2League, t2Position
        );
        t1BaseStrength *= t1Multiplier;
        t2BaseStrength *= t2Multiplier;
    }

    const t1FormBonus = calculateRealisticFormBonus(t1.lastFiveMatches || 'DDDDD');
    const t2FormBonus = calculateRealisticFormBonus(t2.lastFiveMatches || 'DDDDD');

    t1BaseStrength *= t1FormBonus;
    t2BaseStrength *= t2FormBonus;

    const total = t1BaseStrength + t2BaseStrength;
    const t1Prob = t1BaseStrength / total;
    const t2Prob = t2BaseStrength / total;

    let drawProb = calculateRealisticDrawProbability(t1League, t2League, t1Position, t2Position, t1BaseStrength, t2BaseStrength);

    const adjustedT1Prob = t1Prob * (1 - drawProb);
    const adjustedT2Prob = t2Prob * (1 - drawProb);

    const margin = 0.08;

    let team1Odds = Math.max(1.01, Math.min(50.0, (1 / adjustedT1Prob) * (1 - margin)));
    let team2Odds = Math.max(1.01, Math.min(50.0, (1 / adjustedT2Prob) * (1 - margin)));
    let drawOdds = Math.max(2.5, Math.min(20.0, (1 / drawProb) * (1 - margin)));

    const finalOdds = applyFinalOddsLimits(team1Odds, team2Odds, drawOdds, t1League, t1Position, t2League, t2Position);

    return finalOdds;
}

function calculateNewTeamStrength(team, league, position) {
    let baseStrength = 100;

    if (league === 'D1') {
        baseStrength += 150;
    } else if (league === 'D2') {
        baseStrength += 50;
    } else if (league === 'D3') {
        baseStrength -= 50;
    }

    if (position === 1) {
        baseStrength *= (league === 'D1' ? 2.8 : league === 'D2' ? 2.2 : 1.8);
    } else if (position === 2) {
        baseStrength *= (league === 'D1' ? 2.4 : league === 'D2' ? 1.9 : 1.6);
    } else if (position === 3) {
        baseStrength *= (league === 'D1' ? 2.1 : league === 'D2' ? 1.7 : 1.4);
    } else if (position <= 5) {
        baseStrength *= (league === 'D1' ? 1.8 : league === 'D2' ? 1.4 : 1.2);
    } else if (position <= 8) {
        baseStrength *= (league === 'D1' ? 1.5 : league === 'D2' ? 1.1 : 1.0);
    } else if (position <= 12) {
        baseStrength *= (league === 'D1' ? 1.2 : league === 'D2' ? 0.9 : 0.8);
    } else if (position <= 16) {
        baseStrength *= (league === 'D1' ? 1.0 : league === 'D2' ? 0.7 : 0.6);
    } else {
        baseStrength *= (league === 'D1' ? 0.8 : league === 'D2' ? 0.5 : 0.4);
    }

    return Math.max(10, baseStrength);
}

function calculateExtremeInterLeagueMultipliers(t1League, t1Position, t2League, t2Position) {
    let t1Multiplier = 1.0;
    let t2Multiplier = 1.0;

    if (t1League === 'D1' && t2League === 'D2') {
        if (t1Position === 1) {
            if (t2Position >= 18) { t1Multiplier = 8.0; t2Multiplier = 0.15; }
            else if (t2Position >= 15) { t1Multiplier = 6.0; t2Multiplier = 0.2; }
            else if (t2Position >= 10) { t1Multiplier = 4.5; t2Multiplier = 0.25; }
            else if (t2Position >= 5) { t1Multiplier = 3.5; t2Multiplier = 0.35; }
            else { t1Multiplier = 2.8; t2Multiplier = 0.45; }
        } else if (t1Position <= 3) {
            if (t2Position >= 15) { t1Multiplier = 4.5; t2Multiplier = 0.25; }
            else if (t2Position >= 8) { t1Multiplier = 3.2; t2Multiplier = 0.35; }
            else { t1Multiplier = 2.5; t2Multiplier = 0.5; }
        } else if (t1Position <= 8) {
            if (t2Position >= 15) { t1Multiplier = 3.0; t2Multiplier = 0.4; }
            else if (t2Position >= 8) { t1Multiplier = 2.2; t2Multiplier = 0.55; }
            else { t1Multiplier = 1.8; t2Multiplier = 0.65; }
        } else {
            if (t2Position >= 15) { t1Multiplier = 2.0; t2Multiplier = 0.6; }
            else { t1Multiplier = 1.5; t2Multiplier = 0.75; }
        }
    } else if (t1League === 'D2' && t2League === 'D1') {
        const { t1Multiplier: temp1, t2Multiplier: temp2 } = calculateExtremeInterLeagueMultipliers(
            t2League, t2Position, t1League, t1Position
        );
        t1Multiplier = temp2;
        t2Multiplier = temp1;
    }
    return { t1Multiplier, t2Multiplier };
}

function calculateRealisticFormBonus(formString) {
    const wins = (formString.match(/W/g) || []).length;
    const losses = (formString.match(/L/g) || []).length;

    let bonus = 1.0;

    if (wins >= 4) bonus = 1.25;
    else if (wins >= 3) bonus = 1.15;
    else if (wins >= 2) bonus = 1.08;
    else if (wins === 1) bonus = 1.02;

    if (losses >= 4) bonus *= 0.75;
    else if (losses >= 3) bonus *= 0.85;
    else if (losses >= 2) bonus *= 0.92;

    return Math.max(0.7, Math.min(1.3, bonus));
}

function calculateRealisticDrawProbability(t1League, t2League, t1Position, t2Position, t1Strength, t2Strength) {
    let baseDrawProb = 0.20;

    if (t1League !== t2League) {
        baseDrawProb = 0.12;
        const strengthRatio = Math.max(t1Strength, t2Strength) / Math.min(t1Strength, t2Strength);
        if (strengthRatio > 8) baseDrawProb = 0.08;
        else if (strengthRatio > 5) baseDrawProb = 0.10;
        else if (strengthRatio > 3) baseDrawProb = 0.12;
    } else {
        const avgPosition = (t1Position + t2Position) / 2;
        if (avgPosition <= 5) baseDrawProb = 0.18;
        else if (avgPosition <= 10) baseDrawProb = 0.22;
        else baseDrawProb = 0.25;
    }
    return Math.max(0.08, Math.min(0.25, baseDrawProb));
}

function applyFinalOddsLimits(team1Odds, team2Odds, drawOdds, t1League, t1Position, t2League, t2Position) {
    if (t1League === 'D1' && t1Position === 1 && t2League === 'D2' && t2Position >= 18) {
        team1Odds = Math.min(team1Odds, 1.05); team2Odds = Math.max(team2Odds, 25.0); drawOdds = Math.max(drawOdds, 15.0);
    } else if (t1League === 'D1' && t1Position === 1 && t2League === 'D2' && t2Position >= 10) {
        team1Odds = Math.min(team1Odds, 1.10); team2Odds = Math.max(team2Odds, 15.0); drawOdds = Math.max(drawOdds, 12.0);
    } else if (t1League === 'D1' && t1Position <= 3 && t2League === 'D2' && t2Position >= 15) {
        team1Odds = Math.min(team1Odds, 1.20); team2Odds = Math.max(team2Odds, 12.0); drawOdds = Math.max(drawOdds, 10.0);
    } else if (t2League === 'D1' && t2Position === 1 && t1League === 'D2' && t1Position >= 18) {
        team2Odds = Math.min(team2Odds, 1.05); team1Odds = Math.max(team1Odds, 25.0); drawOdds = Math.max(drawOdds, 15.0);
    } else if (t2League === 'D1' && t2Position === 1 && t1League === 'D2' && t1Position >= 10) {
        team2Odds = Math.min(team2Odds, 1.10); team1Odds = Math.max(team1Odds, 15.0); drawOdds = Math.max(drawOdds, 12.0);
    } else if (t2League === 'D1' && t2Position <= 3 && t1League === 'D2' && t1Position >= 15) {
        team2Odds = Math.min(team2Odds, 1.20); team1Odds = Math.max(team1Odds, 12.0); drawOdds = Math.max(drawOdds, 10.0);
    }
    return {
        team1: Math.round(team1Odds * 100) / 100,
        draw: Math.round(drawOdds * 100) / 100,
        team2: Math.round(team2Odds * 100) / 100
    };
}

function calculateCupOdds(t1, t2, t1League, t2League, t1Position, t2Position, tournament) {
    let t1BaseStrength = 100;
    let t2BaseStrength = 100;

    if (t1League === 'D1') t1BaseStrength += 80;
    else if (t1League === 'D2') t1BaseStrength += 30;
    else if (t1League === 'D3') t1BaseStrength -= 40;

    if (t2League === 'D1') t2BaseStrength += 80;
    else if (t2League === 'D2') t2BaseStrength += 30;
    else if (t2League === 'D3') t2BaseStrength -= 40;

    const t1PositionModifier = calculateCupPositionModifier(t1Position, t1League);
    const t2PositionModifier = calculateCupPositionModifier(t2Position, t2League);

    t1BaseStrength *= t1PositionModifier;
    t2BaseStrength *= t2PositionModifier;

    const t1FormBonus = calculateFormBonus(t1.lastFiveMatches || 'DDDDD');
    const t2FormBonus = calculateFormBonus(t2.lastFiveMatches || 'DDDDD');

    t1BaseStrength *= t1FormBonus;
    t2BaseStrength *= t2FormBonus;

    const tournamentFactor = getCupTournamentFactor(tournament, t1League, t2League);
    t1BaseStrength *= tournamentFactor.team1Multiplier;
    t2BaseStrength *= tournamentFactor.team2Multiplier;

    if (t1League === 'D1' && t1Position === 1) {
        if (t2League === 'D2' && t2Position >= 7) { t1BaseStrength *= 5.0; t2BaseStrength *= 0.2; }
        else if (t2League === 'D3' || (t2League === 'D2' && t2Position >= 15)) { t1BaseStrength *= 8.0; t2BaseStrength *= 0.1; }
        else if (t2League === 'D2' && t2Position >= 4) { t1BaseStrength *= 3.5; t2BaseStrength *= 0.3; }
    }
    if (t2League === 'D1' && t2Position === 1) {
        if (t1League === 'D2' && t1Position >= 7) { t2BaseStrength *= 5.0; t1BaseStrength *= 0.2; }
        else if (t1League === 'D3' || (t1League === 'D2' && t1Position >= 15)) { t2BaseStrength *= 8.0; t1BaseStrength *= 0.1; }
        else if (t1League === 'D2' && t1Position >= 4) { t2BaseStrength *= 3.5; t1BaseStrength *= 0.3; }
    }
    if (t1League === 'D1' && t1Position <= 3 && t2League === 'D2' && t2Position >= 8) { t1BaseStrength *= 3.5; t2BaseStrength *= 0.4; }
    if (t2League === 'D1' && t2Position <= 3 && t1League === 'D2' && t1Position >= 8) { t2BaseStrength *= 3.5; t1BaseStrength *= 0.4; }

    const total = t1BaseStrength + t2BaseStrength;
    const t1Prob = t1BaseStrength / total;
    const t2Prob = t2BaseStrength / total;

    let drawProb = 0.16;
    const strengthRatio = Math.max(t1BaseStrength, t2BaseStrength) / Math.min(t1BaseStrength, t2BaseStrength);
    if (strengthRatio > 8) drawProb = 0.05;
    else if (strengthRatio > 5) drawProb = 0.08;
    else if (strengthRatio > 3) drawProb = 0.10;
    else if (strengthRatio > 2) drawProb = 0.12;

    const adjustedT1Prob = t1Prob * (1 - drawProb);
    const adjustedT2Prob = t2Prob * (1 - drawProb);

    const margin = 0.05;

    let team1Odds = Math.max(1.05, Math.min(50.0, (1 / adjustedT1Prob) * (1 - margin)));
    let team2Odds = Math.max(1.05, Math.min(50.0, (1 / adjustedT2Prob) * (1 - margin)));
    let drawOdds = Math.max(3.0, Math.min(25.0, (1 / drawProb) * (1 - margin)));

    return {
        team1: Math.round(team1Odds * 100) / 100,
        draw: Math.round(drawOdds * 100) / 100,
        team2: Math.round(team2Odds * 100) / 100
    };
}

function calculateCupPositionModifier(position, league) {
    let baseModifier = 1.0;
    if (league === 'D1') {
        if (position === 1) baseModifier = 3.5;
        else if (position === 2) baseModifier = 2.8;
        else if (position === 3) baseModifier = 2.4;
        else if (position <= 5) baseModifier = 2.0;
        else if (position <= 8) baseModifier = 1.6;
        else if (position <= 12) baseModifier = 1.3;
        else if (position <= 16) baseModifier = 1.0;
        else baseModifier = 0.8;
    } else if (league === 'D2') {
        if (position === 1) baseModifier = 2.2;
        else if (position === 2) baseModifier = 1.8;
        else if (position === 3) baseModifier = 1.6;
        else if (position <= 5) baseModifier = 1.4;
        else if (position <= 8) baseModifier = 1.1;
        else if (position <= 12) baseModifier = 0.9;
        else if (position <= 16) baseModifier = 0.7;
        else baseModifier = 0.5;
    } else if (league === 'D3') {
        if (position === 1) baseModifier = 1.5;
        else if (position <= 3) baseModifier = 1.2;
        else if (position <= 8) baseModifier = 0.9;
        else baseModifier = 0.7;
    }
    return baseModifier;
}

function calculateFormBonus(formString) {
    const wins = (formString.match(/W/g) || []).length;
    const losses = (formString.match(/L/g) || []).length;
    const draws = (formString.match(/D/g) || []).length;

    let bonus = 1.0;
    if (wins >= 4) bonus = 1.35;
    else if (wins >= 3) bonus = 1.25;
    else if (wins >= 2) bonus = 1.15;
    else if (wins === 1) bonus = 1.05;
    else bonus = 0.85;

    if (losses >= 4) bonus *= 0.65;
    else if (losses >= 3) bonus *= 0.75;
    else if (losses >= 2) bonus *= 0.85;

    if (losses === 0 && wins >= 2) bonus *= 1.1;
    return Math.max(0.5, Math.min(1.8, bonus));
}

function getCupTournamentFactor(tournament, t1League, t2League) {
    let team1Multiplier = 1.0;
    let team2Multiplier = 1.0;

    switch (tournament) {
        case 'maradei':
            if (t1League === 'D1') team1Multiplier *= 1.3;
            if (t2League === 'D1') team2Multiplier *= 1.3;
            if (t1League === 'D2') team1Multiplier *= 0.8;
            if (t2League === 'D2') team2Multiplier *= 0.8;
            if (t1League === 'D3') team1Multiplier *= 0.6;
            if (t2League === 'D3') team2Multiplier *= 0.6;
            break;
        case 'cv': break;
        case 'cd2': break;
        case 'cd3': break;
        case 'izoro':
            if (t1League === 'D1') team1Multiplier *= 1.2;
            if (t2League === 'D1') team2Multiplier *= 1.2;
            if (t1League === 'D2') team1Multiplier *= 0.9;
            if (t2League === 'D2') team2Multiplier *= 0.9;
            break;
        case 'izplata':
            if (t1League === 'D2') team1Multiplier *= 1.15;
            if (t2League === 'D2') team2Multiplier *= 1.15;
            if (t1League === 'D1') team1Multiplier *= 0.9;
            if (t2League === 'D1') team2Multiplier *= 0.9;
            break;
    }
    return { team1Multiplier, team2Multiplier };
}

function calculateExactScoreOdds(match, exactScore) {
    const t1 = teams[match.team1];
    const t2 = teams[match.team2];
    const { home, away } = exactScore;

    let baseOdds;
    // Lógica para calcular cuotas de resultado exacto
    // Esta es una lógica simplificada, puedes ajustarla para que sea más compleja
    if (home === away) { // Empate
        if (home === 0) baseOdds = 8.5;
        else if (home === 1) baseOdds = 6.5;
        else if (home === 2) baseOdds = 12.0;
        else baseOdds = 25.0; // Empates con muchos goles
    } else if (Math.abs(home - away) === 1) { // Diferencia de 1 gol
        if (Math.max(home, away) <= 2) baseOdds = 5.5; // Ej: 1-0, 0-1, 2-1, 1-2
        else baseOdds = 9.0; // Ej: 3-2, 2-3
    } else if (Math.abs(home - away) === 2) { // Diferencia de 2 goles
        if (Math.max(home, away) <= 3) baseOdds = 7.5; // Ej: 2-0, 0-2, 3-1, 1-3
        else baseOdds = 15.0; // Ej: 4-2, 2-4
    } else { // Diferencia mayor
        baseOdds = 20.0 + (Math.abs(home - away) * 8); // Aumenta la cuota con mayor diferencia
    }
    // Ajuste basado en la fuerza de los equipos (simplificado)
    if (t1 && t2) {
        const strengthDiff = Math.abs((t1.position || 10) - (t2.position || 10));
        if (strengthDiff > 10) baseOdds *= 0.8; // Si hay mucha diferencia de fuerza, es menos probable un resultado exacto "sorpresa"
        else if (strengthDiff < 3) baseOdds *= 1.3; // Si son muy parejos, es más probable un resultado exacto "común"
    }
    
    // Asegurar que las cuotas estén en un rango razonable
    return Math.max(4.0, Math.min(80.0, Math.round(baseOdds * 100) / 100));
}

   function calculateSpecialOdds(match, specialType, value = null) {
       const specialOdds = {
           'both_teams_score': 1.10,
           'total_goals_over_2_5': 1.35,
           'total_goals_under_2_5': 2.25,
           'home_goals_over_1_5': 1.25,
           'away_goals_over_1_5': 1.25,
           'total_corners_over_1_5': 1.05,
           'total_corners_over_2_5': 1.15,
           'total_corners_over_3_5': 1.25,
           'total_corners_over_4_5': 1.40,
           'total_corners_over_5_5': 1.60,
           'total_corners_over_6_5': 1.90,
           'total_corners_over_7_5': 2.30,
           'total_corners_over_8_5': 2.80,
           'total_corners_under_1_5': 8.00,
           'total_corners_under_2_5': 4.50,
           'total_corners_under_3_5': 3.00,
           'corner_goal': 8.5,
           'free_kick_goal': 6.0,
           'bicycle_kick_goal': 35.0,
           'header_goal': 1.8,
           'striker_goal': 1.5,
           'midfielder_goal': 2.2,
           'defender_goal': 4.5,
           'goalkeeper_goal': 30.0,
           // --- Nuevas cuotas para tarjetas ---
           'total_yellow_cards_over_2_5': 1.50,
           'total_yellow_cards_over_3_5': 2.00,
           'total_yellow_cards_over_4_5': 2.70,
           'total_red_cards_yes': 3.50,
           'total_red_cards_no': 1.20,
           'team1_yellow_cards_over_1_5': 1.80,
           'team2_yellow_cards_over_1_5': 1.80,
           'team1_red_card_yes': 5.00,
           'team2_red_card_yes': 5.00,
       };
       const t1 = teams[match.team1];
       const t2 = teams[match.team2];
       let odds = specialOdds[specialType] || 5.0;

       if (t1 && t2) {
           const avgPosition = ((t1.position || 10) + (t2.position || 10)) / 2;
           if (avgPosition <= 5) {
               if (['corner_goal', 'free_kick_goal', 'header_goal'].includes(specialType)) {
                   odds *= 0.85;
               }
               // Ajuste para tarjetas en equipos de arriba (menos tarjetas)
               if (specialType.includes('cards')) {
                   odds *= 1.1;
               }
           } else if (avgPosition >= 15) {
               if (specialType.includes('cards')) {
                   odds *= 0.9; // Más tarjetas en equipos de abajo
               }
               odds *= 1.15;
           }
           const t1Form = (t1.lastFiveMatches || 'DDDDD').split('').filter(r => r === 'W').length;
           const t2Form = (t2.lastFiveMatches || 'DDDDD').split('').filter(r => r === 'W').length;
           const avgForm = (t1Form + t2Form) / 2;
           if (avgForm >= 4) odds *= 0.9;
           else if (avgForm <= 1) odds *= 1.1;
       }
       return Math.max(1.1, Math.min(100.0, Math.round(odds * 100) / 100));
   }

function calculateInterLeagueFactor(d1Position, d2Position, matchType) {
    const normalizedD1 = Math.min(20, Math.max(1, d1Position)), normalizedD2 = Math.min(20, Math.max(1, d2Position));
    const d1Quality = (21 - normalizedD1) / 20, d2Quality = (21 - normalizedD2) / 20;
    let team1Multiplier, team2Multiplier;

    if (matchType === 'D1_vs_D2') {
        const qualityGap = d1Quality - d2Quality + 0.3;
        team1Multiplier = 1.0 + Math.max(0.2, qualityGap * 2);
        team2Multiplier = Math.max(0.3, 1.0 - qualityGap * 1.5);
    } else {
        const qualityGap = d1Quality - d2Quality + 0.3;
        team1Multiplier = Math.max(0.3, 1.0 - qualityGap * 1.5);
        team2Multiplier = 1.0 + Math.max(0.2, qualityGap * 2);
    }
    return { team1Multiplier, team2Multiplier };
}

function calculateTeamStrength(team, league) {
    let strength = 50;
    if (league === 'D1') strength += 25;
    else if (league === 'D2') strength += 5;

    const position = team.position || 10;
    if (position === 1) strength += 35;
    else if (position <= 3) strength += 25;
    else if (position <= 6) strength += 15;
    else if (position <= 10) strength += 5;
    else if (position <= 15) strength -= 10;
    else strength -= 20;

    const recentForm = team.lastFiveMatches || 'DDDDD';
    let formPoints = 0, consecutiveWins = 0, consecutiveLosses = 0;

    for (let i = 0; i < recentForm.length; i++) {
        const result = recentForm[i];
        if (result === 'W') { formPoints += 3; consecutiveWins++; consecutiveLosses = 0; }
        else if (result === 'D') { formPoints += 1; consecutiveWins = 0; consecutiveLosses = 0; }
        else if (result === 'L') { formPoints += 0; consecutiveWins = 0; consecutiveLosses++; }
    }

    if (formPoints >= 13) strength += 20;
    else if (formPoints >= 10) strength += 15;
    else if (formPoints >= 7) strength += 5;
    else if (formPoints >= 4) strength -= 10;
    else strength -= 20;

    if (consecutiveWins >= 3) strength += 15;
    else if (consecutiveWins >= 2) strength += 8;
    if (consecutiveLosses >= 3) strength -= 15;
    else if (consecutiveLosses >= 2) strength -= 8;

    if (!recentForm.includes('L')) strength += 12;
    if (!recentForm.includes('W')) strength -= 15;

    return Math.max(15, Math.min(150, strength));
}

// --- Funciones de Scraping de IOSoccer ---
async function scrapeIOSoccerResults(maxPages = 8) {
    const results = [];
    const baseUrl = 'https://iosoccer-sa.com/resultados/t15';

    try {
        console.log('🔍 Iniciando scraping de resultados...');
        for (let page = 1; page <= maxPages; page++) {
            console.log(`📄 Procesando página ${page}/${maxPages}...`);
            try {
                const url = `${baseUrl}?page=${page}`;
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.9', // Updated Accept header
                        'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7', // Updated Accept-Language
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1'
                    },
                    timeout: 15000
                });

                const $ = cheerio.load(response.data);
                let pageResults = 0;

                // Improved selectors for match results
                $('.match-result, .result-item, .game-result, .match-row').each((index, element) => {
                    try {
                        const $row = $(element);
                        let team1, team2, score;

                        // Attempt to find score and teams within the element
                        const scoreText = $row.find('.score, .match-score, .game-score').text().trim();
                        const scoreMatch = scoreText.match(/^(\d+)\s*[-:]\s*(\d+)$/);

                        if (scoreMatch) {
                            score = `${scoreMatch[1]}-${scoreMatch[2]}`;
                            // Try to find team names near the score
                            const teamNames = $row.find('.team-name, .team-info, .club-name').map((i, el) => $(el).text().trim()).get();
                            if (teamNames.length >= 2) {
                                team1 = teamNames[0];
                                team2 = teamNames[1];
                            } else {
                                // Fallback to general text parsing if specific elements not found
                                const fullText = $row.text().trim();
                                const matchPattern = /(.+?)\s+(\d+)\s*[-:]\s*(\d+)\s+(.+)/;
                                const textMatch = fullText.match(matchPattern);
                                if (textMatch) {
                                    team1 = textMatch[1].trim();
                                    team2 = textMatch[4].trim();
                                }
                            }
                        } else {
                            // If no specific score element, try to parse from full row text
                            const fullText = $row.text().trim();
                            const matchPattern = /(.+?)\s+(\d+)\s*[-:]\s*(\d+)\s+(.+)/;
                            const textMatch = fullText.match(matchPattern);
                            if (textMatch) {
                                team1 = textMatch[1].trim();
                                score = `${textMatch[2]}-${textMatch[3]}`;
                                team2 = textMatch[4].trim();
                            }
                        }

                        if (team1 && team2 && score && isValidTeamName(team1) && isValidTeamName(team2) && team1 !== team2) {
                            const cleanedTeam1 = cleanTeamName(team1);
                            const cleanedTeam2 = cleanTeamName(team2);
                            const isDuplicate = results.some(r => r.team1 === cleanedTeam1 && r.team2 === cleanedTeam2 && r.score === score);
                            if (!isDuplicate) {
                                results.push({ team1: cleanedTeam1, team2: cleanedTeam2, score, date: 'Sin fecha', page: page, source: 'iosoccer-sa' });
                                pageResults++;
                            }
                        }
                    } catch (error) { /* Silenciar errores individuales */ }
                });

                // Fallback for table-based results (if any)
                $('table.table-striped tr').each((index, element) => {
                    try {
                        const $row = $(element);
                        const cells = $row.find('td');
                        if (cells.length >= 3) {
                            let team1 = '', team2 = '', score = '';
                            cells.each((i, cell) => {
                                const cellText = $(cell).text().trim();
                                const scoreMatch = cellText.match(/^(\d+)\s*[-:]\s*(\d+)$/);
                                if (scoreMatch && !score) {
                                    score = `${scoreMatch[1]}-${scoreMatch[2]}`;
                                    if (i > 0) {
                                        const prevCell = $(cells[i - 1]).text().trim();
                                        if (isValidTeamName(prevCell)) { team1 = cleanTeamName(prevCell); }
                                    }
                                    if (i < cells.length - 1) {
                                        const nextCell = $(cells[i + 1]).text().trim();
                                        if (isValidTeamName(nextCell)) { team2 = cleanTeamName(nextCell); }
                                    }
                                }
                            });
                            if (team1 && team2 && score && team1 !== team2) {
                                const isDuplicate = results.some(r => r.team1 === team1 && r.team2 === team2 && r.score === score);
                                if (!isDuplicate) {
                                    results.push({ team1, team2, score, date: 'Sin fecha', page: page, source: 'iosoccer-sa' });
                                    pageResults++;
                                }
                            }
                        }
                    } catch (error) { /* Silenciar errores individuales */ }
                });

                console.log(`✅ Página ${page}: ${pageResults} resultados encontrados`);
                if (page < maxPages) { await new Promise(resolve => setTimeout(resolve, 2000)); }
            } catch (error) { console.error(`❌ Error en página ${page}:`, error.message); }
        }
        console.log(`🎯 Scraping completado: ${results.length} resultados totales encontrados`);
        if (results.length > 0) {
            console.log('📋 Ejemplos de resultados encontrados:');
            results.slice(0, 5).forEach((result, i) => { console.log(`  ${i + 1}. ${result.team1} ${result.score} ${result.team2}`); });
        }
        return results;
    } catch (error) {
        console.error('❌ Error general en scraping de resultados:', error.message);
        return results;
    }
}

function isValidTeamName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    const invalidPatterns = [
        /^(grupo|group)\s+[a-z]$/i, /^copa\s+/i, /^torneo\s+/i, /^liga\s+/i, /^division\s+/i,
        /^d[123]$/i, /^t\d+$/i, /^maradei$/i, /^valencia?rc$/i, /^intrazonal/i,
        /^eliminatoria/i, /^semifinal/i, /^final/i, /^cuartos/i, /^octavos/i,
        /^\d+$/, /^[a-z]$/i, /^vs$/i, /^contra$/i, /^fecha\s+\d+/i, /^jornada\s+\d+/i,
        /^round\s+\d+/i, /^ronda\s+\d+/i, /^partido$/i, /^resultado$/i, /^equipo$/i
    ];
    for (const pattern of invalidPatterns) { if (pattern.test(trimmed)) { return false; } }
    if (trimmed.length < 3) return false;
    if (!/[a-zA-Z]/.test(trimmed)) return false;
    return true;
}

function cleanTeamName(name) {
    if (!name) return '';
    return name.trim().replace(/\s+/g, ' ').replace(/[^\w\s\-\.]/g, '').replace(/^(vs|contra)\s+/i, '').replace(/\s+(vs|contra)$/i, '').trim();
}

async function scrapeIOSoccerTeams(league = 'd1') {
    try {
        const url = LEAGUE_URLS[league];
        if (!url) throw new Error(`Liga "${league}" no encontrada. Usa: ${Object.keys(LEAGUE_URLS).join(', ')}`);

        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000
        });
        const $ = cheerio.load(response.data);
        const scrapedTeams = {};

        $('tbody tr').each((index, element) => {
            try {
                const $row = $(element);
                const positionText = $row.find('td:first-child span').text().trim();
                const position = parseInt(positionText);
                const teamName = $row.find('div.hidden.sm\\:block').text().trim();

                let lastFiveMatches = 'DDDDD';

                if (!KNOCKOUT_TOURNAMENTS.includes(league)) {
                    const lastColumn = $row.find('td:last-child');
                    let tempMatches = '';
                    lastColumn.find('div[style*="color"]').each((i, matchDiv) => {
                        if (tempMatches.length >= 5) return;
                        const style = $(matchDiv).attr('style') || '';
                        const text = $(matchDiv).text().trim();
                        if (style.includes('color: green') || text === 'W') tempMatches += 'W';
                        else if (style.includes('color: red') || text === 'L') tempMatches += 'L';
                        else tempMatches += 'D';
                    });
                    if (tempMatches.length > 0) { lastFiveMatches = tempMatches.padEnd(5, 'D').substring(0, 5); }
                }
                if (teamName && teamName.length > 0 && !isNaN(position) && position > 0) {
                    scrapedTeams[`${teamName} (${league.toUpperCase()})`] = {
                        position,
                        lastFiveMatches,
                        league: league.toUpperCase(),
                        tournament: TOURNAMENT_NAMES[league],
                        originalName: teamName
                    };
                } else {
                    console.log(`⚠️ Datos inválidos para fila ${index}: teamName="${teamName}", position="${position}"`);
                }
            } catch (error) { console.log(`⚠️ Error procesando fila ${index} en ${league}:`, error.message); }
        });
        if (Object.keys(scrapedTeams).length === 0) {
            console.log(`⚠️ No se encontraron equipos en ${league}, posible cambio en la estructura del sitio`);
        }
        return scrapedTeams;
    } catch (error) {
        console.error(`❌ Error obteniendo datos de ${league} (${TOURNAMENT_NAMES[league]}):`, error.message);
        return null;
    }
}

async function scrapeAllLeagues() {
    const allTeams = {};
    const tournaments = Object.keys(LEAGUE_URLS);
    try {
        for (let i = 0; i < tournaments.length; i++) {
            const tournament = tournaments[i];
            console.log(`🔍 Obteniendo datos de ${TOURNAMENT_NAMES[tournament]}...`);
            const tournamentTeams = await scrapeIOSoccerTeams(tournament);
            if (tournamentTeams) {
                Object.assign(allTeams, tournamentTeams);
                console.log(`✅ ${TOURNAMENT_NAMES[tournament]}: ${Object.keys(tournamentTeams).length} equipos`);
            }
            if (i < tournaments.length - 1) { await new Promise(resolve => setTimeout(resolve, 2000)); }
        }
        return allTeams;
    } catch (error) { console.error('❌ Error obteniendo todas las ligas:', error.message); return allTeams; }
}

function analyzeTeamPerformance(results) {
    const teamStats = {};
    results.forEach(result => {
        const { team1, team2, score } = result;
        const [goals1, goals2] = score.split('-').map(g => parseInt(g.trim()));
        if (isNaN(goals1) || isNaN(goals2)) return;
        [team1, team2].forEach(teamName => {
            if (!teamStats[teamName]) {
                teamStats[teamName] = { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, lastResults: [] };
            }
        });
        teamStats[team1].matches++; teamStats[team2].matches++;
        teamStats[team1].goalsFor += goals1; teamStats[team1].goalsAgainst += goals2;
        teamStats[team2].goalsFor += goals2; teamStats[team2].goalsAgainst += goals1;
        if (goals1 > goals2) {
            teamStats[team1].wins++; teamStats[team2].losses++;
            teamStats[team1].lastResults.unshift('W'); teamStats[team2].lastResults.unshift('L');
        } else if (goals1 < goals2) {
            teamStats[team1].losses++; teamStats[team2].wins++;
            teamStats[team1].lastResults.unshift('L'); teamStats[team2].lastResults.unshift('W');
        } else {
            teamStats[team1].draws++; teamStats[team2].draws++;
            teamStats[team1].lastResults.unshift('D'); teamStats[team2].lastResults.unshift('D');
        }
        teamStats[team1].lastResults = teamStats[team1].lastResults.slice(0, 5);
        teamStats[team2].lastResults = teamStats[team2].lastResults.slice(0, 5);
    });
    return teamStats;
}

async function updateTeamsWithRealResults(teamStats) {
    let updatedCount = 0;
    for (const [teamName, stats] of Object.entries(teamStats)) {
        const matchedTeam = findTeamByName(teamName);
        if (matchedTeam) {
            const currentTeamData = teams[matchedTeam.fullName];
            if (stats.lastResults.length >= 3) {
                const newForm = stats.lastResults.join('').padEnd(5, 'D').substring(0, 5);
                if (currentTeamData.lastFiveMatches !== newForm) {
                    console.log(`📊 Actualizando forma de ${matchedTeam.fullName}: ${currentTeamData.lastFiveMatches} → ${newForm}`);
                    currentTeamData.lastFiveMatches = newForm;
                    currentTeamData.realStats = {
                        matches: stats.matches, wins: stats.wins, draws: stats.draws, losses: stats.losses,
                        goalsFor: stats.goalsFor, goalsAgainst: stats.goalsAgainst,
                        goalDifference: stats.goalsFor - stats.goalsAgainst,
                        averageGoalsFor: (stats.goalsFor / stats.matches).toFixed(2),
                        averageGoalsAgainst: (stats.goalsAgainst / stats.matches).toFixed(2),
                        winRate: ((stats.wins / stats.matches) * 100).toFixed(1),
                        lastUpdated: new Date().toISOString()
                    };
                    updatedCount++;
                }
            }
        } else {
            console.log(`⚠️ No se encontró coincidencia para: ${teamName}`);
        }
    }
    await saveData(); // Guardar después de actualizar todos los equipos
    return updatedCount;
}

function analyzeResultSurprises(results, teamStats) {
    const surprises = [];
    const bigWins = [];
    results.forEach(result => {
        const { team1, team2, score } = result;
        const [goals1, goals2] = score.split('-').map(g => parseInt(g.trim()));
        if (isNaN(goals1) || isNaN(goals2)) return;
        const goalDiff = Math.abs(goals1 - goals2);
        if (goalDiff >= 4) {
            const winner = goals1 > goals2 ? team1 : team2;
            const loser = goals1 > goals2 ? team2 : team1;
            bigWins.push({ winner, loser, score, goalDifference: goalDiff, type: goalDiff >= 7 ? 'massacre' : goalDiff >= 5 ? 'thrashing' : 'beating' });
        }
        if (goalDiff >= 6) {
            surprises.push({ match: `${team1} ${score} ${team2}`, type: 'potential_upset_or_expected', notes: `Diferencia de ${goalDiff} goles` });
        }
    });
    return { surprises, bigWins };
}

// --- Funciones de Gestión de Partidos y Apuestas ---
function createCustomMatch(team1Name, team2Name, tournament = null) {
    const team1 = findTeamByName(team1Name, tournament);
    const team2 = findTeamByName(team2Name, tournament);

    if (!team1) {
        let message = `No se encontró el equipo "${team1Name}".`;
        if (tournament) { message += ` en ${TOURNAMENT_NAMES[tournament] || tournament}.`; }
        const suggestions = getTeamSuggestions(team1Name, 3, tournament);
        if (suggestions.length > 0) { message += '\n\n**¿Quisiste decir?**\n' + suggestions.map(s => `• **${s.name}** (${s.tournament} - Pos. ${s.position})`).join('\n'); }
        message += `\n\nUsa \`!equipos\` para ver la lista completa.`;
        return { success: false, message };
    }
    if (!team2) {
        let message = `No se encontró el equipo "${team2Name}".`;
        if (tournament) { message += ` en ${TOURNAMENT_NAMES[tournament] || tournament}.`; }
        const suggestions = getTeamSuggestions(team2Name, 3, tournament);
        if (suggestions.length > 0) { message += '\n\n**¿Quisiste decir?**\n' + suggestions.map(s => `• **${s.name}** (${s.tournament} - Pos. ${s.position})`).join('\n'); }
        message += `\n\nUsa \`!equipos\` para ver la lista completa.`;
        return { success: false, message };
    }
    if (team1.fullName === team2.fullName) { return { success: false, message: 'Un equipo no puede jugar contra sí mismo.' }; }

    const matchId = Date.now().toString();
    const odds = calculateOdds(team1.fullName, team2.fullName, tournament);
    const matchTime = new Date(Date.now() + Math.random() * 24 * 60 * 60 * 1000);

    matches[matchId] = {
        id: matchId, team1: team1.fullName, team2: team2.fullName, odds,
        matchTime: matchTime.toISOString(), status: 'upcoming', bets: [],
        isCustom: true, tournament: tournament || 'custom'
    };
    saveData();
    return { success: true, matchId, match: matches[matchId], team1Data: team1, team2Data: team2, tournament: tournament };
}

function findTeamByName(searchName, tournament = null) {
    if (!searchName) return null;
    const search = searchName.toLowerCase().trim();
    let teamEntries = Object.entries(teams);

    if (tournament) {
        teamEntries = teamEntries.filter(([fullName, data]) =>
            data.league === tournament.toUpperCase() ||
            fullName.toLowerCase().includes(`(${tournament.toLowerCase()})`)
        );
    }

    for (const [fullName, data] of teamEntries) { if (fullName.toLowerCase() === search) return { fullName, data }; }
    for (const [fullName, data] of teamEntries) {
        const nameWithoutParens = fullName.replace(/ \([^)]+\)/, '').toLowerCase();
        if (nameWithoutParens === search) return { fullName, data };
    }
    for (const [fullName, data] of teamEntries) {
        const nameWithoutParens = fullName.replace(/ \([^)]+\)/, '').toLowerCase();
        if (nameWithoutParens.includes(search)) { return { fullName, data }; }
        if (search.includes(nameWithoutParens)) { return { fullName, data }; }
    }
    const searchWords = search.split(' ').filter(word => word.length > 2);
    for (const [fullName, data] of teamEntries) {
        const nameWords = fullName.toLowerCase().replace(/ \([^)]+\)/, '').split(' ');
        const matchingWords = searchWords.filter(searchWord =>
            nameWords.some(nameWord =>
                nameWord.includes(searchWord) ||
                searchWord.includes(nameWord) ||
                calculateWordSimilarity(searchWord, nameWord) > 0.8
            )
        );
        if (matchingWords.length >= Math.ceil(searchWords.length * 0.7)) { return { fullName, data }; }
    }
    return null;
}

function calculateWordSimilarity(word1, word2) {
    const longer = word1.length > word2.length ? word1 : word2;
    const shorter = word1.length > word2.length ? word2 : word1;
    if (longer.length === 0) return 1.0;
    const editDistance = calculateEditDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

function calculateEditDistance(str1, str2) {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= str1.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) { matrix[i][j] = matrix[i - 1][j - 1]; }
            else { matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1); }
        }
    }
    return matrix[str2.length][str1.length];
}

function getTeamEmoji(teamName) { return ''; } // No hay emojis en un bot local sin configuración específica

async function giveMoney(fromUserId, toUserId, amount, isAdminTransfer = false) {
    await initUser(toUserId);
    if (isNaN(amount) || amount <= 0) return { success: false, message: 'La cantidad debe ser un número mayor a 0.' };
    if (!isAdminTransfer) {
        await initUser(fromUserId);
        if (userData[fromUserId].balance < amount) return { success: false, message: 'No tienes suficiente dinero para dar esa cantidad.' };
        userData[fromUserId].balance -= amount;
    }
    userData[toUserId].balance += amount;
    await saveData();
    return { success: true, fromBalance: userData[fromUserId] ? userData[fromUserId].balance : null, toBalance: userData[toUserId].balance, amount };
}

function getTeamSuggestions(searchName, limit = 5, tournament = null) {
    if (!searchName) return [];
    const search = searchName.toLowerCase().trim();
    const suggestions = [];
    let teamEntries = Object.entries(teams);

    if (tournament) {
        teamEntries = teamEntries.filter(([fullName, data]) =>
            data.league === tournament.toUpperCase() ||
            fullName.toLowerCase().includes(`(${tournament.toLowerCase()})`)
        );
    }
    for (const [fullName, data] of teamEntries) {
        const nameWithoutLeague = fullName.replace(/ \([^)]+\)/, '');
        const score = calculateSimilarity(search, nameWithoutLeague.toLowerCase());
        if (score > 0.3) {
            suggestions.push({
                name: nameWithoutLeague, fullName, score,
                league: data.league || 'CUSTOM',
                tournament: data.tournament || TOURNAMENT_NAMES[data.league?.toLowerCase()] || 'Custom',
                position: data.position
            });
        }
    }
    return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}

function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    if (longer.length === 0) return 1.0;
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) { if (longer.includes(shorter[i])) { matches++; } }
    return matches / longer.length;
}

function generateRandomMatches() {
    const teamNames = Object.keys(teams);
    if (teamNames.length < 2) return null;

    let team1Name, team2Name;
    do {
        team1Name = teamNames[Math.floor(Math.random() * teamNames.length)];
        team2Name = teamNames[Math.floor(Math.random() * teamNames.length)];
    } while (team1Name === team2Name);

    const team1 = teams[team1Name];
    const team2 = teams[team2Name];

    const matchId = Date.now().toString();
    const odds = calculateOdds(team1Name, team2Name, team1.tournament);
    const matchTime = new Date(Date.now() + Math.random() * 24 * 60 * 60 * 1000);

    matches[matchId] = {
        id: matchId, team1: team1Name, team2: team2Name, odds,
        matchTime: matchTime.toISOString(), status: 'upcoming', bets: [],
        isCustom: false, tournament: team1.tournament
    };
    saveData();
    return matchId;
}

async function simulateMatch(matchId) {
    const match = matches[matchId];
    if (!match || match.status !== 'upcoming') return null;

    const t1 = teams[match.team1], t2 = teams[match.team2];
    if (!t1 || !t2) return null;

    const t1League = t1.league || (match.team1.includes('(D1)') ? 'D1' : 'D2');
    const t2League = t2.league || (match.team2.includes('(D2)') ? 'D2' : 'D1');

    let t1Strength = calculateTeamStrength(t1, t1League);
    let t2Strength = calculateTeamStrength(t2, t2League);

    if (t1League === 'D1' && t2League === 'D2') {
        const positionFactor = calculateInterLeagueFactor(t1.position, t2.position, 'D1_vs_D2');
        t1Strength *= positionFactor.team1Multiplier;
        t2Strength *= positionFactor.team2Multiplier;
    } else if (t1League === 'D2' && t2League === 'D1') {
        const positionFactor = calculateInterLeagueFactor(t2.position, t1.position, 'D2_vs_D1');
        t1Strength *= positionFactor.team2Multiplier;
        t2Strength *= positionFactor.team1Multiplier;
    }

    const total = t1Strength + t2Strength;
    const t1Prob = t1Strength / total;

    let drawProb = t1League !== t2League ? (((t1.position + t2.position) / 2) <= 5 ? 0.15 : ((t1.position + t2.position) / 2) <= 15 ? 0.12 : 0.08) : 0.22;

    const random = Math.random();
    let result = random < t1Prob * (1 - drawProb) ? 'team1' : random < (1 - drawProb) ? 'team2' : 'draw';

    let score1, score2;
    if (result === 'team1') {
        if (t1League === 'D1' && t2League === 'D2') { score1 = Math.floor(Math.random() * 4) + 2; score2 = Math.floor(Math.random() * 2); }
        else { score1 = Math.floor(Math.random() * 3) + 1; score2 = Math.floor(Math.random() * score1); }
    } else if (result === 'team2') {
        if (t2League === 'D1' && t1League === 'D2') { score2 = Math.floor(Math.random() * 4) + 2; score1 = Math.floor(Math.random() * 2); }
        else { score2 = Math.floor(Math.random() * 3) + 1; score1 = Math.floor(Math.random() * score2); }
    } else { score1 = score2 = Math.floor(Math.random() * 3); }

    match.status = 'finished';
    match.result = result;
    match.score = `${score1}-${score2}`;
    matchResults[matchId] = { result, score: `${score1}-${score2}`, timestamp: new Date().toISOString() };
    await processMatchBets(matchId, result, score1, score2, {});
    await saveData();
    broadcastUpdate('match-result', { matchId, result, score: `${score1}-${score2}` });
    return { result, score: `${score1}-${score2}` };
}

async function setManualResult(matchId, result, score1, score2, specialEvents = {}, additionalStats = {}) {
    const match = matches[matchId];
    if (!match) return { success: false, message: 'No existe un partido con ese ID.' };
    if (match.status !== 'upcoming') return { success: false, message: 'Este partido ya tiene un resultado establecido.' };
    if (!['team1', 'draw', 'team2'].includes(result)) return { success: false, message: 'Resultado inválido. Usa: team1, draw, o team2.' };
    if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0) return { success: false, message: 'El marcador debe ser números válidos (0 o mayor).' };
    if (result === 'team1' && score1 <= score2) return { success: false, message: 'El marcador no coincide con la victoria del equipo 1.' };
    if (result === 'team2' && score2 <= score1) return { success: false, message: 'El marcador no coincide con la victoria del equipo 2.' };
    if (result === 'draw' && score1 !== score2) return { success: false, message: 'Para empate, ambos equipos deben tener el mismo marcador.' };
    match.status = 'finished';
    match.result = result;
    match.score = `${score1}-${score2}`;
    matchResults[matchId] = {
        result,
        score: `${score1}-${score2}`,
        timestamp: new Date().toISOString(),
        isManual: true,
        specialResults: specialEvents, // Guardar los eventos especiales
        additionalStats: additionalStats // Guardar las estadísticas adicionales
    };

    await processMatchBets(matchId, result, score1, score2, specialEvents); // Pasar specialEvents a processMatchBets
    await saveData();
    return { success: true, match, result, score: `${score1}-${score2}` };
}

// ... (código anterior) ...
async function processMatchBets(matchId, result, goals1 = null, goals2 = null, specialResults = {}) {
    const match = matches[matchId];
    if (!match || !match.bets) return;
    for (let betId of match.bets) {
        const bet = bets[betId];
        if (!bet) continue;
        let won = false;
        if (bet.betType === 'exact_score' && goals1 !== null && goals2 !== null) {
            won = bet.exactScore.home === goals1 && bet.exactScore.away === goals2;
        } else if (bet.betType === 'special' && bet.specialType) {
            won = checkSpecialBets(bet.specialType, goals1, goals2, specialResults);
        } else if (bet.betType === 'special_combined' && bet.specialBets) {
            // Para apuestas combinadas, todas las sub-apuestas deben ser correctas
            // specialBets es un array de objetos {type, name, odds}
            const specialTypesToCheck = bet.specialBets.map(item => item.type);
            won = specialTypesToCheck.every(type => checkSpecialBets(type, goals1, goals2, specialResults));
        } else {
            // Apuestas simples (team1, draw, team2)
            won = bet.prediction === result;
        }
        bet.status = won ? 'won' : 'lost';
        bet.result = result; // Guardar el resultado del partido en la apuesta
        if (won) {
            const winnings = bet.amount * bet.odds;
            userData[bet.userId].balance += winnings;
            userData[bet.userId].wonBets++;
            userData[bet.userId].totalWinnings += winnings;
        } else {
            userData[bet.userId].lostBets++;
        }
    }
    await saveData();
}

   function checkSpecialBets(specialTypeOrArray, goals1, goals2, specialResults) {
       if (Array.isArray(specialTypeOrArray)) {
           console.error("checkSpecialBets called with an array. This should not happen anymore.");
           return false;
       }

       const specialType = specialTypeOrArray;
       const totalCorners = specialResults['total_corners'] || 0;
       const totalYellowCards = specialResults['total_yellow_cards'] || 0;
       const totalRedCards = specialResults['total_red_cards'] || 0;
       const team1YellowCards = specialResults['team1_yellow_cards'] || 0;
       const team2YellowCards = specialResults['team2_yellow_cards'] || 0;
       const team1RedCard = specialResults['team1_red_card'] === true;
       const team2RedCard = specialResults['team2_red_card'] === true;

       switch (specialType) {
           case 'both_teams_score': return goals1 > 0 && goals2 > 0;
           case 'total_goals_over_2_5': return (goals1 + goals2) > 2.5;
           case 'total_goals_under_2_5': return (goals1 + goals2) < 2.5;
           case 'home_goals_over_1_5': return goals1 > 1.5;
           case 'away_goals_over_1_5': return goals2 > 1.5;
           case 'total_corners_over_1_5': return totalCorners > 1.5;
           case 'total_corners_over_2_5': return totalCorners > 2.5;
           case 'total_corners_over_3_5': return totalCorners > 3.5;
           case 'total_corners_over_4_5': return totalCorners > 4.5;
           case 'total_corners_over_5_5': return totalCorners > 5.5;
           case 'total_corners_over_6_5': return totalCorners > 6.5;
           case 'total_corners_over_7_5': return totalCorners > 7.5;
           case 'total_corners_over_8_5': return totalCorners > 8.5;
           case 'total_corners_under_1_5': return totalCorners < 1.5;
           case 'total_corners_under_2_5': return totalCorners < 2.5;
           case 'total_corners_under_3_5': return totalCorners < 3.5;
           case 'corner_goal': return specialResults['corner_goal'] === true;
           case 'free_kick_goal': return specialResults['free_kick_goal'] === true;
           case 'bicycle_kick_goal': return specialResults['bicycle_kick_goal'] === true;
           case 'header_goal': return specialResults['header_goal'] === true;
           case 'striker_goal': return specialResults['striker_goal'] === true;
           case 'midfielder_goal': return specialResults['midfielder_goal'] === true;
           case 'defender_goal': return specialResults['defender_goal'] === true;
           case 'goalkeeper_goal': return specialResults['goalkeeper_goal'] === true;
           // --- Nuevas verificaciones para tarjetas ---
           case 'total_yellow_cards_over_2_5': return totalYellowCards > 2.5;
           case 'total_yellow_cards_over_3_5': return totalYellowCards > 3.5;
           case 'total_yellow_cards_over_4_5': return totalYellowCards > 4.5;
           case 'total_red_cards_yes': return totalRedCards > 0;
           case 'total_red_cards_no': return totalRedCards === 0;
           case 'team1_yellow_cards_over_1_5': return team1YellowCards > 1.5;
           case 'team2_yellow_cards_over_1_5': return team2YellowCards > 1.5;
           case 'team1_red_card_yes': return team1RedCard;
           case 'team2_red_card_yes': return team2RedCard;
           default: return false;
       }
   }

async function deleteMatch(matchId) {
    if (!matches[matchId]) return { success: false, message: 'No existe un partido con ese ID.' };
    const match = matches[matchId];
    if (match.status === 'finished') return { success: false, message: 'No se puede eliminar un partido que ya terminó.' };

    if (match.bets && match.bets.length > 0) {
        for (let betId of match.bets) {
            const bet = bets[betId];
            if (bet && bet.status === 'pending') {
                userData[bet.userId].balance += bet.amount;
                userData[bet.userId].totalBets--;
                delete bets[betId];
            }
        }
    }
    delete matches[matchId];
    await saveData();
    return { success: true, message: `Partido eliminado correctamente. ${match.bets ? match.bets.length : 0} apuestas fueron canceladas y el dinero devuelto.`, match };
}

async function deleteAllUpcomingMatches() {
    const upcomingMatchIds = Object.keys(matches).filter(id => matches[id].status === 'upcoming');
    if (upcomingMatchIds.length === 0) return { success: false, message: 'No hay partidos pendientes para eliminar.' };

    let totalBetsReturned = 0, totalMoneyReturned = 0;

    for (let matchId of upcomingMatchIds) {
        const match = matches[matchId];
        if (match.bets && match.bets.length > 0) {
            for (let betId of match.bets) {
                const bet = bets[betId];
                if (bet && bet.status === 'pending') {
                    userData[bet.userId].balance += bet.amount;
                    userData[bet.userId].totalBets--;
                    totalBetsReturned++;
                    totalMoneyReturned += bet.amount;
                    delete bets[betId];
                }
            }
        }
        delete matches[matchId];
    }
    await saveData();
    return { success: true, message: `Se eliminaron ${upcomingMatchIds.length} partidos pendientes. ${totalBetsReturned} apuestas canceladas y ${totalMoneyReturned} devuelto a los usuarios.`, deletedCount: upcomingMatchIds.length, betsReturned: totalBetsReturned, moneyReturned: totalMoneyReturned };
}

async function deleteFinishedMatches() {
    const finishedMatchIds = Object.keys(matches).filter(id => matches[id].status === 'finished');
    if (finishedMatchIds.length === 0) return { success: false, message: 'No hay partidos terminados para eliminar.' };

    for (let matchId of finishedMatchIds) {
        delete matches[matchId];
        if (matchResults[matchId]) delete matchResults[matchId];
    }
    await saveData();
    return { success: true, message: `Se eliminaron ${finishedMatchIds.length} partidos terminados del historial.`, deletedCount: finishedMatchIds.length };
}

function getTeamDetailedStats(teamName) {
    const team = findTeamByName(teamName);
    if (!team) return null;

    const teamData = team.data;
    const stats = {
        name: team.fullName.replace(/ \([^)]+\)/, ''),
        league: teamData.league || 'CUSTOM',
        tournament: teamData.tournament || 'Custom',
        position: teamData.position || '?',
        form: teamData.lastFiveMatches || 'DDDDD',
        realStats: teamData.realStats || null
    };

    const formResults = stats.form.split('');
    const wins = formResults.filter(r => r === 'W').length;
    const draws = formResults.filter(r => r === 'D').length;
    const losses = formResults.filter(r => r === 'L').length;

    stats.formAnalysis = {
        wins, draws, losses,
        points: wins * 3 + draws,
        percentage: ((wins * 3 + draws) / 15 * 100).toFixed(1)
    };
    return stats;
}

// --- Servidor Web (Express, Socket.io, Passport) ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// Configuración de URL de callback
const getCallbackURL = () => {
    if (process.env.NODE_ENV === 'production' && process.env.PRODUCTION_URL) {
        return `${process.env.PRODUCTION_URL}/auth/discord/callback`;
    }
    return 'http://localhost:3000/auth/discord/callback';
};

console.log('🔧 Configuración OAuth Discord:');
console.log('  - Client ID:', process.env.DISCORD_CLIENT_ID);
console.log('  - Callback URL:', getCallbackURL());
console.log('  - Environment:', process.env.NODE_ENV || 'development');

// Configuración Passport
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: getCallbackURL(),
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('✅ Usuario autenticado desde Discord:', profile.username || 'Sin username');
        console.log('🔍 Profile ID:', profile.id);
        console.log('📋 Profile data:', {
            id: profile.id,
            username: profile.username,
            discriminator: profile.discriminator,
            avatar: profile.avatar,
            verified: profile.verified
        });
        
        // Verificar que tenemos los datos mínimos necesarios
        if (!profile.id) {
            throw new Error('Profile ID missing from Discord response');
        }
        
        await initUser(profile.id, profile.username, profile.discriminator, profile.avatar);
        
        const userProfile = {
            id: profile.id,
            username: profile.username || 'Usuario',
            discriminator: profile.discriminator || '0000',
            avatar: profile.avatar,
            accessToken: accessToken
        };
        
        console.log('👤 UserProfile creado exitosamente:', userProfile.username);
        return done(null, userProfile);
    } catch (error) {
        console.error('❌ Error en estrategia Discord:', error);
        console.error('❌ Error stack:', error.stack);
        return done(error, null);
    }
}));

passport.serializeUser((user, done) => {
    console.log('📦 Serializando usuario:', user.username);
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        console.log('📦 Deserializando usuario con ID:', id);
        if (!userData[id]) {
            console.log('⚠️ Usuario no encontrado en userData, inicializando...');
            await initUser(id);
        }
        const user = userData[id];
        if (user) {
            const userProfile = {
                id: id,
                username: user.username || 'Usuario',
                discriminator: user.discriminator || '0000',
                avatar: user.avatar,
                balance: user.balance || 1000,
                totalBets: user.totalBets || 0,
                wonBets: user.wonBets || 0,
                lostBets: user.lostBets || 0,
                totalWinnings: user.totalWinnings || 0
            };
            console.log('✅ Usuario deserializado correctamente:', userProfile.username);
            done(null, userProfile);
        } else {
            console.log('❌ Usuario no encontrado después de inicializar');
            done(null, null);
        }
    } catch (error) {
        console.error('❌ Error deserializando usuario:', error);
        done(error, null);
    }
});

// Middleware
app.use(cookieParser());

// Configuración de sesiones con MongoStore en producción
const sessionConfig = {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production', // true en producción (HTTPS)
        httpOnly: true,
        sameSite: 'lax'
    },
    name: 'discord-auth-session'
};

// Usar MongoStore solo en producción
if (process.env.NODE_ENV === 'production') {
    sessionConfig.store = MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: 'sessions',
        ttl: 24 * 60 * 60 // 1 día en segundos
    });
    console.log('✅ Usando MongoStore para sesiones en producción');
} else {
    console.log('⚠️  Usando MemoryStore para sesiones en desarrollo');
}

app.use(session(sessionConfig));
app.use(passport.initialize());
app.use(passport.session());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) { req.isAuthenticated() ? next() : res.status(401).json({ error: 'No autenticado' }); }

// Rutas de Autenticación
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
    passport.authenticate('discord', {
        failureRedirect: '/?error=auth_failed',
        failureMessage: true
    }),
    async (req, res) => {
        try {
            console.log('🔄 Callback de Discord ejecutado');
            if (req.user) {
                console.log('✅ Usuario en callback:', req.user.username);
                await initUser(req.user.id, req.user.username, req.user.discriminator, req.user.avatar);
                console.log(`✅ Usuario autenticado exitosamente: ${req.user.username} - Balance: ${userData[req.user.id]?.balance || 1000}`);
                res.redirect('/dashboard');
            } else {
                console.log('❌ No hay usuario en req.user');
                res.redirect('/?error=no_user');
            }
        } catch (error) {
            console.error('❌ Error en callback:', error);
            res.redirect('/?error=callback_error');
        }
    }
);
app.get('/logout', (req, res) => {
    console.log('🚪 Usuario cerrando sesión:', req.user ? req.user.username : 'Desconocido');
    req.logout((err) => {
        if (err) { console.error('❌ Error al cerrar sesión:', err); return res.status(500).json({ error: 'Error al cerrar sesión' }); }
        req.session.destroy((err) => {
            if (err) { console.error('❌ Error destruyendo sesión:', err); }
            res.clearCookie('discord-auth-session');
            res.redirect('/');
        });
    });
});

// Rutas API
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/auth/status', async (req, res) => {
    try {
        console.log('🔍 Verificando estado de autenticación...');
        console.log('isAuthenticated:', req.isAuthenticated());
        console.log('req.user:', req.user);
        console.log('session:', req.session);
        
        if (req.isAuthenticated() && req.user) {
            console.log('✅ Usuario autenticado encontrado:', req.user.id);
            if (!userData[req.user.id]) { 
                console.log('⚠️ Usuario no encontrado en userData, inicializando...');
                await initUser(req.user.id, req.user.username, req.user.discriminator, req.user.avatar); 
            }
            const user = userData[req.user.id];
            const responseData = {
                authenticated: true,
                user: {
                    id: req.user.id,
                    username: user.username || req.user.username || 'Usuario',
                    discriminator: user.discriminator || req.user.discriminator || '0000',
                    avatar: user.avatar || req.user.avatar,
                    balance: user.balance || 1000,
                    totalBets: user.totalBets || 0,
                    wonBets: user.wonBets || 0,
                    lostBets: user.lostBets || 0,
                    totalWinnings: user.totalWinnings || 0
                }
            };
            console.log('📤 Enviando datos de usuario:', responseData);
            res.json(responseData);
        } else { 
            console.log('❌ Usuario no autenticado');
            res.json({ authenticated: false }); 
        }
    } catch (error) { 
        console.error('❌ Error verificando estado:', error); 
        res.json({ authenticated: false, error: error.message }); 
    }
});

app.get('/api/admin/check', requireAuth, (req, res) => {
    res.json({ isAdmin: isAdmin(req.user.id) });
});
app.get('/debug/session', (req, res) => {
    res.json({ sessionID: req.sessionID, isAuthenticated: req.isAuthenticated(), user: req.user, session: req.session });
});

app.post('/api/bet', requireAuth, async (req, res) => {
    if (bettingPaused) { return res.status(403).json({ error: 'Las apuestas están actualmente pausadas por un administrador.' }); }
    const { matchId, prediction, amount } = req.body;
    const userId = req.user.id;
    if (!matches[matchId]) return res.status(400).json({ error: 'No existe un partido con ese ID' });
    if (matches[matchId].status !== 'upcoming') return res.status(400).json({ error: 'No puedes apostar en un partido que ya terminó' });
    if (!['team1', 'draw', 'team2'].includes(prediction)) return res.status(400).json({ error: 'Predicción inválida' });
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'La cantidad debe ser un número mayor a 0' });
    if (userData[userId].balance < amount) return res.status(400).json({ error: 'No tienes suficiente dinero para esta apuesta' });

    const betId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const odds = matches[matchId].odds[prediction];
    bets[betId] = { id: betId, userId, matchId, prediction, amount, odds, status: 'pending', timestamp: new Date().toISOString(), betType: 'simple' };
    userData[userId].balance -= amount;
    userData[userId].totalBets++;
    if (!matches[matchId].bets) matches[matchId].bets = [];
    matches[matchId].bets.push(betId);
    await saveData();
    broadcastUpdate('new-bet', { matchId, userId, amount });
    res.json({ success: true, bet: bets[betId], newBalance: userData[userId].balance });
});

app.get('/api/matches', (req, res) => res.json(Object.values(matches).filter(m => m.status === 'upcoming')));
app.get('/api/stats', (req, res) => res.json({ totalMatches: Object.values(matches).filter(m => m.status === 'upcoming').length, totalUsers: Object.keys(userData).length, totalBets: Object.keys(bets).length, totalVolume: Object.values(bets).reduce((sum, bet) => sum + bet.amount, 0) }));
app.get('/api/recent-bets', (req, res) => res.json(Object.values(bets).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10).map(bet => {
    const match = matches[bet.matchId];
    if (!match) return null;
    let predictionText;
    if (bet.betType === 'exact_score' && bet.exactScore) { predictionText = `Exacto ${bet.exactScore.home}-${bet.exactScore.away}`; }
    else if (bet.betType === 'special' && bet.description) { predictionText = bet.description; }
    else if (bet.betType === 'special_combined' && bet.description) { predictionText = bet.description; }
    else if (bet.prediction) { predictionText = bet.prediction === 'team1' ? match.team1.split(' (')[0] : bet.prediction === 'team2' ? match.team2.split(' (')[0] : 'Empate'; }
    else if (bet.description) { predictionText = bet.description; } // Fallback si description ya está en bet
    else { predictionText = 'Apuesta especial'; } // Fallback genérico
    return { match: `${match.team1.split(' (')[0]} vs ${match.team2.split(' (')[0]}`, prediction: predictionText, amount: bet.amount, status: bet.status };
}).filter(bet => bet !== null)));

app.get('/api/user/bets', requireAuth, (req, res) => {
    const userId = req.user.id;
    const userBets = Object.values(bets).filter(bet => bet.userId === userId).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20).map(bet => {
        const match = matches[bet.matchId];
        if (!match) return null;
        let predictionText;
        if (bet.betType === 'exact_score' && bet.exactScore) { predictionText = `Exacto ${bet.exactScore.home}-${bet.exactScore.away}`; }
        else if (bet.betType === 'special' && bet.description) { predictionText = bet.description; }
        else if (bet.betType === 'special_combined' && bet.description) { predictionText = bet.description; }
        else if (bet.prediction) { predictionText = bet.prediction === 'team1' ? match.team1.split(' (')[0] : bet.prediction === 'team2' ? match.team2.split(' (')[0] : 'Empate'; }
        else if (bet.description) { predictionText = bet.description; } // Fallback si description ya está en bet
        else { predictionText = 'Apuesta especial'; } // Fallback genérico
        return { ...bet, match: { team1: match.team1.split(' (')[0], team2: match.team2.split(' (')[0], result: match.result, score: match.score }, predictionText, potentialWinning: bet.amount * bet.odds };
    }).filter(bet => bet !== null);
    res.json(userBets);
});

app.get('/api/user/stats', requireAuth, async (req, res) => {
    const userId = req.user.id;
    await initUser(userId); // Asegurarse de que el usuario esté cargado
    const user = userData[userId];
    const winRate = user.totalBets > 0 ? (user.wonBets / user.totalBets * 100).toFixed(1) : 0;
    const profit = user.totalWinnings - (user.totalBets > 0 ? user.totalBets * (user.totalWinnings / user.wonBets || 0) : 0); // Ajuste para calcular el profit real
    res.json({ ...user, winRate: parseFloat(winRate), profit, averageBet: user.totalBets > 0 ? (user.totalWinnings / user.totalBets).toFixed(2) : 0 });
});

        // Dentro de las rutas API (después de app.get('/api/user/bets', ...))
       // ... (código existente) ...
   app.get('/api/match/odds/:matchId', (req, res) => {
       const matchId = req.params.matchId;
       const match = matches[matchId];
       if (!match) {
           return res.status(404).json({ error: 'Partido no encontrado' });
       }

       const basicOdds = match.odds;

       const exactScores = {};
       const commonScores = [
           {home: 0, away: 0}, {home: 1, away: 0}, {home: 0, away: 1}, {home: 1, away: 1},
           {home: 2, away: 0}, {home: 0, away: 2}, {home: 2, away: 1}, {home: 1, away: 2},
           {home: 2, away: 2}, {home: 3, away: 0}, {home: 0, away: 3}, {home: 3, away: 1},
           {home: 1, away: 3}, {home: 3, away: 2}, {home: 2, away: 3}, {home: 2, away: 3},
           {home: 3, away: 3}, {home: 4, away: 0}, {home: 0, away: 4}, {home: 4, away: 1},
           {home: 1, away: 4}, {home: 4, away: 2}, {home: 2, away: 4}, {home: 4, away: 3},
           {home: 3, away: 4}, {home: 4, away: 4}
       ];
       commonScores.forEach(score => {
           exactScores[`${score.home}-${score.away}`] = calculateExactScoreOdds(match, score);
       });

       const specialOdds = {
           'both_teams_score': calculateSpecialOdds(match, 'both_teams_score'),
           'total_goals_over_2_5': calculateSpecialOdds(match, 'total_goals_over_2_5'),
           'total_goals_under_2_5': calculateSpecialOdds(match, 'total_goals_under_2_5'),
           'home_goals_over_1_5': calculateSpecialOdds(match, 'home_goals_over_1_5'),
           'away_goals_over_1_5': calculateSpecialOdds(match, 'away_goals_over_1_5'),
           'total_corners_over_1_5': calculateSpecialOdds(match, 'total_corners_over_1_5'),
           'total_corners_over_2_5': calculateSpecialOdds(match, 'total_corners_over_2_5'),
           'total_corners_over_3_5': calculateSpecialOdds(match, 'total_corners_over_3_5'),
           'total_corners_over_4_5': calculateSpecialOdds(match, 'total_corners_over_4_5'),
           'total_corners_over_5_5': calculateSpecialOdds(match, 'total_corners_over_5_5'),
           'total_corners_over_6_5': calculateSpecialOdds(match, 'total_corners_over_6_5'),
           'total_corners_over_7_5': calculateSpecialOdds(match, 'total_corners_over_7_5'),
           'total_corners_over_8_5': calculateSpecialOdds(match, 'total_corners_over_8_5'),
           'total_corners_under_1_5': calculateSpecialOdds(match, 'total_corners_under_1_5'),
           'total_corners_under_2_5': calculateSpecialOdds(match, 'total_corners_under_2_5'),
           'total_corners_under_3_5': calculateSpecialOdds(match, 'total_corners_under_3_5'),
           'corner_goal': calculateSpecialOdds(match, 'corner_goal'),
           'free_kick_goal': calculateSpecialOdds(match, 'free_kick_goal'),
           'bicycle_kick_goal': calculateSpecialOdds(match, 'bicycle_kick_goal'),
           'header_goal': calculateSpecialOdds(match, 'header_goal'),
           'striker_goal': calculateSpecialOdds(match, 'striker_goal'),
           'midfielder_goal': calculateSpecialOdds(match, 'midfielder_goal'),
           'defender_goal': calculateSpecialOdds(match, 'defender_goal'),
           'goalkeeper_goal': calculateSpecialOdds(match, 'goalkeeper_goal'),
           // --- Nuevas cuotas para tarjetas ---
           'total_yellow_cards_over_2_5': calculateSpecialOdds(match, 'total_yellow_cards_over_2_5'),
           'total_yellow_cards_over_3_5': calculateSpecialOdds(match, 'total_yellow_cards_over_3_5'),
           'total_yellow_cards_over_4_5': calculateSpecialOdds(match, 'total_yellow_cards_over_4_5'),
           'total_red_cards_yes': calculateSpecialOdds(match, 'total_red_cards_yes'),
           'total_red_cards_no': calculateSpecialOdds(match, 'total_red_cards_no'),
           'team1_yellow_cards_over_1_5': calculateSpecialOdds(match, 'team1_yellow_cards_over_1_5'),
           'team2_yellow_cards_over_1_5': calculateSpecialOdds(match, 'team2_yellow_cards_over_1_5'),
           'team1_red_card_yes': calculateSpecialOdds(match, 'team1_red_card_yes'),
           'team2_red_card_yes': calculateSpecialOdds(match, 'team2_red_card_yes'),
       };

       res.json({
           match: { id: match.id, team1: match.team1.split(' (')[0], team2: match.team2.split(' (')[0], matchTime: match.matchTime, status: match.status },
           basicOdds,
           exactScores,
           specialOdds
       });
   });

        // Modificar el endpoint de apuesta especial para manejar combinadas
       // ... (código existente) ...
   app.post('/api/bet/special', requireAuth, async (req, res) => {
       if (bettingPaused) { return res.status(403).json({ error: 'Las apuestas están actualmente pausadas por un administrador.' }); }
       const { matchId, betType, amount, data } = req.body;
       const userId = req.user.id;

       if (!matches[matchId]) { return res.status(400).json({ error: 'No existe un partido con ese ID' }); }
       if (matches[matchId].status !== 'upcoming') { return res.status(400).json({ error: 'No puedes apostar en un partido que ya terminó' }); }
       if (isNaN(amount) || amount <= 0) { return res.status(400).json({ error: 'La cantidad debe ser un número mayor a 0' }); }
       if (userData[userId].balance < amount) { return res.status(400).json({ error: 'No tienes suficiente dinero para esta apuesta' }); }

       let betOdds, betDescription, betSpecificData = {};
       const match = matches[matchId];

       const specialNames = {
           'both_teams_score': 'Ambos equipos marcan', 'total_goals_over_2_5': 'Más de 2.5 goles',
           'total_goals_under_2_5': 'Menos de 2.5 goles', 'home_goals_over_1_5': `Más de 1.5 goles ${match.team1.split(' (')[0]}`,
           'total_corners_over_1_5': 'Más de 1.5 córners',
           'total_corners_over_2_5': 'Más de 2.5 córners',
           'total_corners_over_3_5': 'Más de 3.5 córners',
           'total_corners_over_4_5': 'Más de 4.5 córners',
           'total_corners_over_5_5': 'Más de 5.5 córners',
           'total_corners_over_6_5': 'Más de 6.5 córners',
           'total_corners_over_7_5': 'Más de 7.5 córners',
           'total_corners_over_8_5': 'Más de 8.5 córners',
           'total_corners_under_1_5': 'Menos de 1.5 córners',
           'total_corners_under_2_5': 'Menos de 2.5 córners',
           'total_corners_under_3_5': 'Menos de 3.5 córners',
           'away_goals_over_1_5': `Más de 1.5 goles ${match.team2.split(' (')[0]}`, 'corner_goal': 'Gol de córner',
           'free_kick_goal': 'Gol de tiro libre', 'bicycle_kick_goal': 'Gol de chilena',
           'header_goal': 'Gol de cabeza', 'striker_goal': 'Gol de delantero',
           'midfielder_goal': 'Gol de mediocampista', 'defender_goal': 'Gol de defensa',
           'goalkeeper_goal': 'Gol de arquero',
           // --- Nuevos nombres para tarjetas ---
           'total_yellow_cards_over_2_5': 'Más de 2.5 tarjetas amarillas totales',
           'total_yellow_cards_over_3_5': 'Más de 3.5 tarjetas amarillas totales',
           'total_yellow_cards_over_4_5': 'Más de 4.5 tarjetas amarillas totales',
           'total_red_cards_yes': 'Habrá tarjeta roja',
           'total_red_cards_no': 'No habrá tarjeta roja',
           'team1_yellow_cards_over_1_5': `Más de 1.5 tarjetas amarillas ${match.team1.split(' (')[0]}`,
           'team2_yellow_cards_over_1_5': `Más de 1.5 tarjetas amarillas ${match.team2.split(' (')[0]}`,
           'team1_red_card_yes': `Tarjeta roja para ${match.team1.split(' (')[0]}`,
           'team2_red_card_yes': `Tarjeta roja para ${match.team2.split(' (')[0]}`,
       };

       if (betType === 'exact_score') {
           const { home, away } = data;
           if (isNaN(home) || isNaN(away) || home < 0 || away < 0) { return res.status(400).json({ error: 'Resultado exacto inválido' }); }
           betOdds = calculateExactScoreOdds(match, { home, away });
           betDescription = `Resultado exacto ${home}-${away}`;
           betSpecificData = { exactScore: { home, away } };
       } else if (betType === 'special') {
           const specialType = data.specialType;
           if (!specialNames[specialType]) { return res.status(400).json({ error: 'Tipo de apuesta especial no válido' }); }
           betOdds = calculateSpecialOdds(match, specialType);
           betDescription = specialNames[specialType];
           betSpecificData = { specialType };
       } else if (betType === 'special_combined') {
           const specialBets = data.specialBets;
           if (!Array.isArray(specialBets) || specialBets.length === 0) { return res.status(400).json({ error: 'Debe incluir al menos una apuesta especial' }); }

           // --- Lógica de restricciones para apuestas combinadas ---
           const goalBets = specialBets.filter(type => type.startsWith('total_goals_') || type.startsWith('home_goals_') || type.startsWith('away_goals_'));
           const cornerBets = specialBets.filter(type => type.startsWith('total_corners_'));
           const yellowCardBets = specialBets.filter(type => type.startsWith('total_yellow_cards_') || type.startsWith('team1_yellow_cards_') || type.startsWith('team2_yellow_cards_'));
           const redCardBets = specialBets.filter(type => type.startsWith('total_red_cards_') || type.startsWith('team1_red_card_') || type.startsWith('team2_red_card_'));

           if (goalBets.length > 1) {
               return res.status(400).json({ error: 'No se puede combinar más de una apuesta de goles (Más/Menos de X.5 goles).' });
           }
           if (cornerBets.length > 1) {
               return res.status(400).json({ error: 'No se puede combinar más de una apuesta de córners (Más/Menos de X.5 córners).' });
           }
           if (yellowCardBets.length > 1) {
               return res.status(400).json({ error: 'No se puede combinar más de una apuesta de tarjetas amarillas.' });
           }
           if (redCardBets.length > 1) {
               return res.status(400).json({ error: 'No se puede combinar más de una apuesta de tarjetas rojas.' });
           }

           // Restricción: "Ambos marcan" solo se puede combinar con UNA de las apuestas de goles/córners/tarjetas
           const bothTeamsScoreBet = specialBets.includes('both_teams_score');
           const otherCombinedBetsCount = (goalBets.length > 0 ? 1 : 0) + (cornerBets.length > 0 ? 1 : 0) + (yellowCardBets.length > 0 ? 1 : 0) + (redCardBets.length > 0 ? 1 : 0);

           if (bothTeamsScoreBet && otherCombinedBetsCount > 1) {
               return res.status(400).json({ error: 'La apuesta "Ambos equipos marcan" solo se puede combinar con una única apuesta de goles, córners o tarjetas.' });
           }
           // --- Fin de la lógica de restricciones ---

           let combinedOdds = 1.0;
           const detailedSpecialBets = [];
           for (const type of specialBets) {
               if (!specialNames[type]) { return res.status(400).json({ error: `Tipo de apuesta especial no válido: ${type}` }); }
               const individualOdds = calculateSpecialOdds(match, type);
               combinedOdds *= individualOdds;
               detailedSpecialBets.push({ type: type, name: specialNames[type], odds: individualOdds });
           }
           betOdds = parseFloat((combinedOdds).toFixed(2));
           betDescription = specialBets.map(type => specialNames[type]).join(' + ');
           betSpecificData = { specialBets: detailedSpecialBets };
       } else { return res.status(400).json({ error: 'Tipo de apuesta no válido' }); }

       const betId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
       bets[betId] = {
           id: betId, userId, matchId, amount, odds: betOdds, status: 'pending', timestamp: new Date().toISOString(),
           betType: betType, description: betDescription, ...betSpecificData
       };
       userData[userId].balance -= amount;
       userData[userId].totalBets++;
       if (!matches[matchId].bets) matches[matchId].bets = [];
       matches[matchId].bets.push(betId);
       await saveData();
       broadcastUpdate('new-bet', { matchId, userId, amount });
       res.json({ success: true, bet: { id: betId, description: betDescription, amount, odds: betOdds, potentialWinning: Math.round(amount * betOdds) }, newBalance: userData[userId].balance });
   });
    

app.get('/api/finished-matches', (req, res) => {
    const finishedMatches = Object.values(matches)
        .filter(m => m.status === 'finished')
        .sort((a, b) => new Date(b.matchTime) - new Date(a.matchTime))
        .slice(0, 20)
        .map(match => ({
            id: match.id, team1: match.team1.split(' (')[0], team2: match.team2.split(' (')[0],
            result: match.result, score: match.score, matchTime: match.matchTime,
            isCustom: match.isCustom || false, isManual: matchResults[match.id]?.isManual || false,
            tournament: match.tournament ? TOURNAMENT_NAMES[match.tournament.toLowerCase()] : 'Custom' // Añadir nombre completo del torneo
        }));
    res.json(finishedMatches);
});

app.post('/api/set-result', requireAuth, async (req, res) => {
    if (!isAdmin(req.user.id)) { return res.status(403).json({ error: 'No tienes permisos para establecer resultados' }); }
    const { matchId, result, score1, score2, specialEvents = [], additionalStats = {} } = req.body; // Recibir specialEvents y additionalStats
    const manualResultResponse = await setManualResult(matchId, result, parseInt(score1), parseInt(score2), specialEvents, additionalStats); // Pasar ambos
    if (manualResultResponse.success) {
        const match = manualResultResponse.match;
        broadcastUpdate('match-result', { matchId, result: match.result, score: match.score, isManual: true, specialResults: matchResults[match.id]?.specialResults });
        res.json({
            success: true,
            match: {
                id: match.id, team1: match.team1.split(' (')[0], team2: match.team2.split(' (')[0],
                result: match.result, score: match.score, isManual: true, specialResults: matchResults[match.id]?.specialResults
            }
        });
    } else { res.status(400).json({ error: manualResultResponse.message }); }
});

app.get('/api/pending-matches', requireAuth, (req, res) => {
    if (!isAdmin(req.user.id)) { return res.status(403).json({ error: 'No tienes permisos para ver esta información' }); }
    const pendingMatches = Object.values(matches)
        .filter(m => m.status === 'upcoming')
        .sort((a, b) => new Date(a.matchTime) - new Date(b.matchTime))
        .map(match => ({
            id: match.id, team1: match.team1.split(' (')[0], team2: match.team2.split(' (')[0],
            matchTime: match.matchTime, isCustom: match.isCustom || false, betsCount: match.bets ? match.bets.length : 0
        }));
    res.json(pendingMatches);
});

app.get('/api/top-users', (req, res) => {
    try {
        const topUsers = Object.entries(userData)
            .map(([userId, user]) => ({
                id: userId, username: user.username || 'Usuario', discriminator: user.discriminator || '0000',
                avatar: user.avatar, balance: user.balance || 1000, totalBets: user.totalBets || 0,
                wonBets: user.wonBets || 0, lostBets: user.lostBets || 0, totalWinnings: user.totalWinnings || 0,
                winRate: user.totalBets > 0 ? (user.wonBets / user.totalBets * 100).toFixed(1) : 0
            }))
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 10);
        res.json(topUsers);
    } catch (error) { console.error('❌ Error obteniendo top usuarios:', error); res.status(500).json({ error: 'Error interno del servidor' }); }
});

app.get('/api/stats/general', (req, res) => {
    try {
        const totalUsers = Object.keys(userData).length;
        const totalMatches = Object.values(matches).filter(m => m.status === 'upcoming').length;
        const totalFinishedMatches = Object.values(matches).filter(m => m.status === 'finished').length;
        const totalBets = Object.keys(bets).length;
        const totalVolume = Object.values(bets).reduce((sum, bet) => sum + bet.amount, 0);
        const activeBets = Object.values(bets).filter(bet => bet.status === 'pending').length;

        const richestUser = Object.values(userData).reduce((richest, user) => {
            return (user.balance || 1000) > (richest.balance || 1000) ? user : richest;
        }, { balance: 0 });

        res.json({
            totalUsers, totalMatches, totalFinishedMatches, totalBets, totalVolume, activeBets,
            richestUserBalance: richestUser.balance || 1000,
            averageUserBalance: totalUsers > 0 ? Math.round(Object.values(userData).reduce((sum, user) => sum + (user.balance || 1000), 0) / totalUsers) : 1000
        });
    } catch (error) { console.error('❌ Error obteniendo estadísticas generales:', error); res.status(500).json({ error: 'Error interno del servidor' }); }
});

// --- Socket.io ---
io.on('connection', (socket) => {
    socket.emit('initial-data', { matches: Object.values(matches).filter(m => m.status === 'upcoming'), stats: { totalMatches: Object.values(matches).filter(m => m.status === 'upcoming').length, totalUsers: Object.keys(userData).length, totalBets: Object.keys(bets).length, totalVolume: Object.values(bets).reduce((sum, bet) => sum + bet.amount, 0) } });
});

function broadcastUpdate(type, data) { io.emit('update', { type, data }); }

// --- Discord Bot Client ---
const client = new Discord.Client({ intents: [Discord.GatewayIntentBits.Guilds, Discord.GatewayIntentBits.GuildMessages, Discord.GatewayIntentBits.MessageContent] });

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    await initUser(message.author.id, message.author.username, message.author.discriminator, message.author.avatar);

    switch (command) {
        case '!crearmatch':
        case '!crearpartido':
        case '!match':
            if (args.length < 3) {
                const tournamentsText = Object.entries(TOURNAMENT_NAMES).map(([code, name]) => `• \`${code}\` - ${name}`).join('\n');
                message.reply(`❌ Uso: \`!crearmatch <equipo1> vs <equipo2> [torneo]\`\n**Ejemplos:**\n\`!crearmatch "Boca" vs "River"\`\n\`!crearmatch "Aimstar" vs "Deportivo Tarrito" maradei\`\n\n**Torneos disponibles:**\n${tournamentsText}\n\n**💡 Nota:** Los torneos de copa tienen cuotas ajustadas.`);
                return;
            }
            const fullCommand = message.content.slice(command.length).trim();
            const vsIndex = fullCommand.toLowerCase().indexOf(' vs ');
            if (vsIndex === -1) { message.reply('❌ Formato incorrecto. Usa: `!crearmatch <equipo1> vs <equipo2> [torneo]`'); return; }

            const team1Input = fullCommand.slice(0, vsIndex).trim().replace(/"/g, '');
            const restOfCommand = fullCommand.slice(vsIndex + 4).trim();
            let team2Input, selectedTournament = null;
            const possibleTournaments = Object.keys(TOURNAMENT_NAMES);
            const lastWord = restOfCommand.split(' ').pop().toLowerCase();

            if (possibleTournaments.includes(lastWord)) {
                selectedTournament = lastWord;
                team2Input = restOfCommand.slice(0, restOfCommand.lastIndexOf(' ')).trim().replace(/"/g, '');
            } else { team2Input = restOfCommand.replace(/"/g, ''); }

            if (!team1Input || !team2Input) { message.reply('❌ Debes especificar ambos equipos.'); return; }

            const customResult = createCustomMatch(team1Input, team2Input, selectedTournament);
            if (!customResult.success) {
                let suggestionText = customResult.message;
                if (customResult.message.includes('No se encontró el equipo')) {
                    const failedTeam = customResult.message.includes(`"${team1Input}"`) ? team1Input : team2Input;
                    const suggestions = getTeamSuggestions(failedTeam, 3, selectedTournament);
                    if (suggestions.length > 0) { suggestionText += '\n\n**¿Quisiste decir?**\n' + suggestions.map(s => `• ${getTeamEmoji(s.fullName)} **${s.name}** (${s.tournament} - Pos. ${s.position})`).join('\n'); }
                }
                message.reply(suggestionText);
                return;
            }
            const customMatch = customResult.match;
            const t1Data = customResult.team1Data;
            const t2Data = customResult.team2Data;
            const customT1League = t1Data.data.league || 'CUSTOM';
            const customT2League = t2Data.data.league || 'CUSTOM';

            let customAnalysisText;
            if (selectedTournament) { customAnalysisText = `🏆 **${TOURNAMENT_NAMES[selectedTournament]}**\nPos. ${t1Data.data.position || '?'} vs Pos. ${t2Data.data.position || '?'}`; }
            else if (customT1League !== customT2League) { customAnalysisText = `🔥 **Partido Inter-Liga**\n${t1Data.data.tournament || customT1League} vs ${t2Data.data.tournament || customT2League}`; }
            else { customAnalysisText = `📊 **${t1Data.data.tournament || customT1League}**\nPos. ${t1Data.data.position || '?'} vs Pos. ${t2Data.data.position || '?'}`; }

            const customMatchEmbed = new Discord.EmbedBuilder()
                .setColor('#9900ff').setTitle('🎯 Partido Creado')
                .addFields(
                    { name: 'ID del Partido', value: customResult.matchId, inline: false },
                    { name: 'Equipos', value: `${getTeamEmoji(customMatch.team1)} **${customMatch.team1.split(' (')[0]}** vs **${customMatch.team2.split(' (')[0]}** ${getTeamEmoji(customMatch.team2)}`, inline: false },
                    { name: 'Torneo', value: customAnalysisText, inline: false },
                    { name: 'Cuotas', value: `**${customMatch.team1.split(' (')[0]}**: ${customMatch.odds.team1}\n**Empate**: ${customMatch.odds.draw}\n**${customMatch.team2.split(' (')[0]}**: ${customMatch.odds.team2}`, inline: false },
                    { name: 'Forma Reciente', value: `${customMatch.team1.split(' (')[0]}: ${t1Data.data.lastFiveMatches || 'DDDDD'}\n${customMatch.team2.split(' (')[0]}: ${t2Data.data.lastFiveMatches || 'DDDDD'}`, inline: false },
                    { name: 'Hora del partido', value: new Date(customMatch.matchTime).toLocaleString(), inline: false }
                ).setFooter({ text: 'Partido listo para apostar! Usa !apostar <ID> <team1/draw/team2> <cantidad>' });
            message.reply({ embeds: [customMatchEmbed] });
            break;

        case '!balance':
        case '!dinero':
            const user = userData[message.author.id];
            const embed = new Discord.EmbedBuilder()
                .setColor('#00ff00').setTitle('💰 Tu Balance')
                .addFields(
                    { name: 'Dinero disponible', value: `${user.balance}`, inline: true },
                    { name: 'Apuestas totales', value: `${user.totalBets}`, inline: true },
                    { name: 'Apuestas ganadas', value: `${user.wonBets}`, inline: true },
                    { name: 'Apuestas perdidas', value: `${user.lostBets}`, inline: true },
                    { name: 'Ganancias totales', value: `${user.totalWinnings}`, inline: true },
                    { name: 'Tasa de éxito', value: `${user.totalBets > 0 ? Math.round((user.wonBets / user.totalBets) * 100) : 0}%`, inline: true }
                );
            message.reply({ embeds: [embed] });
            break;

        case '!equipos':
        case '!teams':
            if (Object.keys(teams).length === 0) { message.reply('❌ No hay equipos registrados. Usa `!actualizartodo` para obtener equipos de IOSoccer.'); return; }
            const teamsByTournament = {};
            Object.entries(teams).forEach(([name, data]) => {
                const tournament = data.tournament || TOURNAMENT_NAMES[data.league?.toLowerCase()] || 'Otros';
                if (!teamsByTournament[tournament]) { teamsByTournament[tournament] = []; }
                teamsByTournament[tournament].push([name, data]);
            });
            Object.keys(teamsByTournament).forEach(tournament => { teamsByTournament[tournament].sort((a, b) => a[1].position - b[1].position); });
            let teamText = '';
            const tournamentOrder = ['Liga D1', 'Liga D2', 'Liga D3', 'Copa Maradei', 'Copa ValencARc', 'Copa D2', 'Copa D3', 'Copa Intrazonal de Oro', 'Copa Intrazonal de Plata'];
            tournamentOrder.forEach(tournament => {
                if (teamsByTournament[tournament] && teamsByTournament[tournament].length > 0) {
                    const isKnockout = ['Copa ValencARc', 'Copa Intrazonal de Oro', 'Copa Intrazonal de Plata', 'Copa D2', 'Copa D3'].includes(tournament);
                    const emoji = tournament.includes('Liga') ? '🏆' : '🏅';
                    teamText += `**${emoji} ${tournament}**\n`;
                    teamText += teamsByTournament[tournament].slice(0, 10).map(([name, data]) => {
                        const teamName = name.replace(/ \([^)]+\)/, '');
                        const formText = isKnockout ? '(Eliminatoria)' : `(${data.lastFiveMatches || 'DDDDD'})`;
                        return `${data.position}. ${getTeamEmoji(name)} **${teamName}** ${formText}`;
                    }).join('\n');
                    if (teamsByTournament[tournament].length > 10) { teamText += `\n... y ${teamsByTournament[tournament].length - 10} más`; }
                    teamText += '\n\n';
                }
            });
            Object.keys(teamsByTournament).forEach(tournament => {
                if (!tournamentOrder.includes(tournament)) {
                    teamText += `**🎯 ${tournament}**\n`;
                    teamText += teamsByTournament[tournament].slice(0, 5).map(([name, data]) => `${data.position}. ${getTeamEmoji(name)} **${name.replace(/ \([^)]+\)/, '')}** (${data.lastFiveMatches || 'DDDDD'})`).join('\n') + '\n\n';
                }
            });
            const teamsEmbed = new Discord.EmbedBuilder()
                .setColor('#0099ff').setTitle('🏆 Equipos por Torneo | IOSoccer Sudamérica')
                .setDescription(teamText || 'No hay equipos registrados')
                .setFooter({ text: 'W=Victoria, D=Empate, L=Derrota | Usa !actualizartodo para actualizar' });
            message.reply({ embeds: [teamsEmbed] });
            break;

        case '!partidos':
        case '!matches':
            const upcomingMatches = Object.values(matches).filter(m => m.status === 'upcoming');
            if (upcomingMatches.length === 0) { message.reply('❌ No hay partidos próximos. Usa `!generarmatch` para crear partidos.'); return; }
            const matchesText = upcomingMatches.map(match => {
                const matchTime = new Date(match.matchTime);
                const t1 = teams[match.team1], t2 = teams[match.team2];
                const t1Emoji = getTeamEmoji(match.team1), t2Emoji = getTeamEmoji(match.team2);
                const t1League = t1?.league || (match.team1.includes('(D1)') ? 'D1' : 'D2');
                const t2League = t2?.league || (match.team2.includes('(D2)') ? 'D2' : 'D1');
                const t1Form = t1?.lastFiveMatches || 'DDDDD', t2Form = t2?.lastFiveMatches || 'DDDDD';
                const t1Position = t1?.position || '?', t2Position = t2?.position || '?';
                let matchAnalysis = t1League !== t2League ? `🔥 **INTER-LIGA** - D1 (pos.${t1League === 'D1' ? t1Position : t2Position}) vs D2 (pos.${t1League === 'D1' ? t2Position : t1Position})` : `📊 Intra-liga ${t1League} - Pos.${t1Position} vs Pos.${t2Position}`;
                const customIndicator = match.isCustom ? ' 🎯 **PERSONALIZADO**' : '';
                return `**ID: ${match.id}**${customIndicator}\n${t1Emoji} **${match.team1.split(' (')[0]}** vs **${match.team2.split(' (')[0]}** ${t2Emoji}\n${matchAnalysis}\n📅 ${matchTime.toLocaleString()}\n💰 **${match.team1.split(' (')[0]}** (${match.odds.team1}) | **Empate** (${match.odds.draw}) | **${match.team2.split(' (')[0]}** (${match.odds.team2})\n📈 Forma: ${t1Form} vs ${t2Form}\n`;
            }).join('\n');
            const matchesEmbed = new Discord.EmbedBuilder().setColor('#ff9900').setTitle('⚽ Próximos Partidos').setDescription(matchesText);
            message.reply({ embeds: [matchesEmbed] });
            break;

        case '!generarmatch':
            if (Object.keys(teams).length < 2) { message.reply('❌ Necesitas al menos 2 equipos para generar un partido.'); return; }
            const newMatchId = generateRandomMatches();
            const newMatch = matches[newMatchId];
            const newT1 = teams[newMatch.team1], newT2 = teams[newMatch.team2];
            const newT1League = newT1?.league || (newMatch.team1.includes('(D1)') ? 'D1' : 'D2');
            const newT2League = newT2?.league || (newMatch.team2.includes('(D2)') ? 'D2' : 'D1');
            let analysisText = newT1League !== newT2League ? `🔥 **Partido**\nD1 (posición ${newT1League === 'D1' ? (newT1?.position || '?') : (newT2?.position || '?')}) vs D2 (posición ${newT1League === 'D1' ? (newT2?.position || '?') : (newT1?.position || '?')})` : `📊 Partido ${newT1League}`;
            const newMatchEmbed = new Discord.EmbedBuilder()
                .setColor('#00ff00').setTitle('✅ Nuevo Partido Generado')
                .addFields(
                    { name: 'ID del Partido', value: newMatchId, inline: false },
                    { name: 'Equipos', value: `${getTeamEmoji(newMatch.team1)} ${newMatch.team1.split(' (')[0]} vs ${newMatch.team2.split(' (')[0]} ${getTeamEmoji(newMatch.team2)}`, inline: false },
                    { name: 'Análisis', value: analysisText, inline: false },
                    { name: 'Cuotas', value: `${newMatch.team1.split(' (')[0]}: ${newMatch.odds.team1}\nEmpate: ${newMatch.odds.draw}\n${newMatch.team2.split(' (')[0]}: ${newMatch.odds.team2}`, inline: false },
                    { name: 'Hora del partido', value: new Date(newMatch.matchTime).toLocaleString(), inline: false }
                );
            message.reply({ embeds: [newMatchEmbed] });
            break;

        case '!apostar':
        case '!bet':
            if (bettingPaused) { message.reply('❌ Las apuestas están actualmente pausadas por un administrador.'); return; }
            if (args.length < 4) { message.reply('❌ Uso: `!apostar <ID_partido> <team1/draw/team2> <cantidad>`\nEjemplo: `!apostar 1234567890 team1 100`'); return; }
            const matchId = args[1], prediction = args[2].toLowerCase(), amount = parseFloat(args[3]);
            if (!matches[matchId]) { message.reply('❌ No existe un partido con ese ID.'); return; }
            if (matches[matchId].status !== 'upcoming') { message.reply('❌ No puedes apostar en un partido que ya terminó.'); return; }
            if (!['team1', 'draw', 'team2'].includes(prediction)) { message.reply('❌ Predicción inválida. Usa: team1, draw, o team2.'); return; }
            if (isNaN(amount) || amount <= 0) { message.reply('❌ La cantidad debe ser un número mayor a 0.'); return; }
            if (userData[message.author.id].balance < amount) { message.reply('❌ No tienes suficiente dinero para esta apuesta.'); return; }
            const betId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
            const odds = matches[matchId].odds[prediction];
            bets[betId] = { id: betId, userId: message.author.id, matchId, prediction, amount, odds, status: 'pending', timestamp: new Date().toISOString(), betType: 'simple' };
            userData[message.author.id].balance -= amount;
            userData[message.author.id].totalBets++;
            if (!matches[matchId].bets) matches[matchId].bets = [];
            matches[matchId].bets.push(betId);
            await saveData();
            broadcastUpdate('new-bet', { matchId, userId: message.author.id, amount });
            const match = matches[matchId];
            let predictionText = prediction === 'team1' ? match.team1.split(' (')[0] : prediction === 'team2' ? match.team2.split(' (')[0] : 'Empate';
            const betEmbed = new Discord.EmbedBuilder()
                .setColor('#00ff00').setTitle('✅ Apuesta Realizada')
                .addFields(
                    { name: 'Partido', value: `${match.team1.split(' (')[0]} vs ${match.team2.split(' (')[0]}`, inline: false },
                    { name: 'Tu predicción', value: predictionText, inline: true },
                    { name: 'Cantidad apostada', value: `${amount}`, inline: true },
                    { name: 'Cuota', value: odds.toString(), inline: true },
                    { name: 'Ganancia potencial', value: `${Math.round(amount * odds)}`, inline: true },
                    { name: 'Balance restante', value: `${userData[message.author.id].balance}`, inline: true }
                );
            message.reply({ embeds: [betEmbed] });
            break;

        case '!simular':
        case '!simulate':
            if (args.length < 2) { message.reply('❌ Uso: `!simular <ID_partido>`'); return; }
            const simMatchId = args[1];
            if (!matches[simMatchId]) { message.reply('❌ No existe un partido con ese ID.'); return; }
            if (matches[simMatchId].status !== 'upcoming') { message.reply('❌ Este partido ya fue simulado.'); return; }
            const result = await simulateMatch(simMatchId);
            const simMatch = matches[simMatchId];
            let winnerText = result.result === 'team1' ? simMatch.team1.split(' (')[0] : result.result === 'team2' ? simMatch.team2.split(' (')[0] : 'Empate';
            const resultEmbed = new Discord.EmbedBuilder()
                .setColor('#ff0000').setTitle('🏁 Resultado del Partido')
                .addFields(
                    { name: 'Partido', value: `${getTeamEmoji(simMatch.team1)} ${simMatch.team1.split(' (')[0]} vs ${simMatch.team2.split(' (')[0]} ${getTeamEmoji(simMatch.team2)}`, inline: false },
                    { name: 'Resultado', value: result.score, inline: true },
                    { name: 'Ganador', value: winnerText, inline: true }
                );
            message.reply({ embeds: [resultEmbed] });
            break;

        case '!dar':
        case '!give':
        case '!dardinero':
            if (args.length < 3) { message.reply('❌ Uso: `!dar <@usuario> <cantidad>`\nEjemplo: `!dar @amigo 500`'); return; }
            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) { message.reply('❌ Debes mencionar a un usuario válido. Ejemplo: `!dar @amigo 500`'); return; }
            if (mentionedUser.id === message.author.id) { message.reply('❌ No puedes darte dinero a ti mismo.'); return; }
            if (mentionedUser.bot) { message.reply('❌ No puedes dar dinero a un bot.'); return; }
            const amountToGive = parseFloat(args[2]);
            const giveResult = await giveMoney(message.author.id, mentionedUser.id, amountToGive, false);
            if (giveResult.success) {
                const giveEmbed = new Discord.EmbedBuilder()
                    .setColor('#00ff00').setTitle('💸 Transferencia Realizada')
                    .addFields(
                        { name: 'De', value: `${message.author.username}`, inline: true },
                        { name: 'Para', value: `${mentionedUser.username}`, inline: true },
                        { name: 'Cantidad', value: `${amountToGive}`, inline: true },
                        { name: 'Tu nuevo balance', value: `${giveResult.fromBalance}`, inline: true },
                        { name: `Balance de ${mentionedUser.username}`, value: `${giveResult.toBalance}`, inline: true }
                    ).setTimestamp();
                message.reply({ embeds: [giveEmbed] });
                try { mentionedUser.send(`💰 ${message.author.username} te ha enviado ${amountToGive} dinero. Tu nuevo balance es: ${giveResult.toBalance}`); } catch (error) { }
            } else message.reply(`❌ ${giveResult.message}`);
            break;

        case '!admindar':
        case '!admingive':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            if (args.length < 3) { message.reply('❌ Uso: `!admindar <@usuario> <cantidad>`\nEjemplo: `!admindar @usuario 1000`'); return; }
            const adminMentionedUser = message.mentions.users.first();
            if (!adminMentionedUser) { message.reply('❌ Debes mencionar a un usuario válido.'); return; }
            if (adminMentionedUser.bot) { message.reply('❌ No puedes dar dinero a un bot.'); return; }
            const adminAmountToGive = parseFloat(args[2]);
            const adminGiveResult = await giveMoney(message.author.id, adminMentionedUser.id, adminAmountToGive, true);
            if (adminGiveResult.success) {
                const adminGiveEmbed = new Discord.EmbedBuilder()
                    .setColor('#ff9900').setTitle('👑 Dinero Otorgado por Admin')
                    .addFields(
                        { name: 'Admin', value: `${message.author.username}`, inline: true },
                        { name: 'Usuario', value: `${adminMentionedUser.username}`, inline: true },
                        { name: 'Cantidad otorgada', value: `${adminAmountToGive}`, inline: true },
                        { name: `Nuevo balance de ${adminMentionedUser.username}`, value: `${adminGiveResult.toBalance}`, inline: false }
                    ).setTimestamp();
                message.reply({ embeds: [adminGiveEmbed] });
                try { adminMentionedUser.send(`🎁 El administrador ${message.author.username} te ha otorgado ${adminAmountToGive} dinero. Tu nuevo balance es: ${adminGiveResult.toBalance}`); } catch (error) { }
            } else message.reply(`❌ ${adminGiveResult.message}`);
            break;

           // ... (código existente) ...
   case '!resultado':
   case '!setresult':
       if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
       if (args.length < 5) {
           message.reply(`❌ **Uso:** \`!resultado <ID_partido> <team1/draw/team2> <goles_equipo1> <goles_equipo2> [especiales] [corners:<cantidad>] [amarillas:<total>] [rojas:<total>] [amarillas1:<cantidad>] [amarillas2:<cantidad>] [roja1] [roja2]\`\n**Especiales opcionales (separados por comas):**\ncorner, libre, chilena, cabeza, delantero, medio, defensa, arquero\n**Ejemplo:** \`!resultado 1234567890 team1 2 1 corner,cabeza corners:10 amarillas:3 rojas:1 amarillas1:2 roja2\``);
           return;
       }
       const resultMatchId = args[1];
       const manualResult = args[2].toLowerCase();
       const goals1 = parseInt(args[3]);
       const goals2 = parseInt(args[4]);

       let specialEvents = [];
       let additionalStats = {}; // Usaremos esto para las tarjetas

       // Parsear argumentos adicionales
       for (let i = 5; i < args.length; i++) {
           const arg = args[i].toLowerCase();
           if (arg.startsWith('corners:')) {
               additionalStats['total_corners'] = parseInt(arg.split(':')[1]);
           } else if (arg.startsWith('amarillas:')) {
               additionalStats['total_yellow_cards'] = parseInt(arg.split(':')[1]);
           } else if (arg.startsWith('rojas:')) {
               additionalStats['total_red_cards'] = parseInt(arg.split(':')[1]);
           } else if (arg.startsWith('amarillas1:')) {
               additionalStats['team1_yellow_cards'] = parseInt(arg.split(':')[1]);
           } else if (arg.startsWith('amarillas2:')) {
               additionalStats['team2_yellow_cards'] = parseInt(arg.split(':')[1]);
           } else if (arg === 'roja1') {
               additionalStats['team1_red_card'] = true;
           } else if (arg === 'roja2') {
               additionalStats['team2_red_card'] = true;
           } else {
               specialEvents = arg.split(',').map(s => s.trim());
           }
       }

       const specialResults = {};
       specialEvents.forEach(event => {
           const eventLower = event.toLowerCase();
           switch (eventLower) {
               case 'corner': specialResults['corner_goal'] = true; break;
               case 'libre': case 'tiro-libre': specialResults['free_kick_goal'] = true; break;
               case 'chilena': case 'bicycle': specialResults['bicycle_kick_goal'] = true; break;
               case 'cabeza': case 'header': specialResults['header_goal'] = true; break;
               case 'delantero': case 'striker': specialResults['striker_goal'] = true; break;
               case 'medio': case 'mediocampista': case 'midfielder': specialResults['midfielder_goal'] = true; break;
               case 'defensa': case 'defender': specialResults['defender_goal'] = true; break;
               case 'arquero': case 'portero': case 'goalkeeper': specialResults['goalkeeper_goal'] = true; break;
               default: console.log(`⚠️ Evento especial no reconocido: ${event}`);
           }
       });

       // Combinar additionalStats con specialResults para pasarlos a setManualResult
       Object.assign(specialResults, additionalStats);

       const manualResultResponse = await setManualResult(resultMatchId, manualResult, goals1, goals2, specialResults);
       if (manualResultResponse.success) {
           const match = manualResultResponse.match;
           let winnerText = manualResultResponse.result === 'team1' ? match.team1.split(' (')[0] : manualResultResponse.result === 'team2' ? match.team2.split(' (')[0] : 'Empate';
           const specialEventsText = specialEvents.length > 0 ? `\n**Eventos especiales:** ${specialEvents.join(', ')}` : '';
           const cornersText = additionalStats['total_corners'] !== undefined ? `\n**Córners totales:** ${additionalStats['total_corners']}` : '';
           const yellowCardsText = additionalStats['total_yellow_cards'] !== undefined ? `\n**Tarjetas Amarillas:** ${additionalStats['total_yellow_cards']}` : '';
           const redCardsText = additionalStats['total_red_cards'] !== undefined ? `\n**Tarjetas Rojas:** ${additionalStats['total_red_cards']}` : '';
           const teamYellowCardsText = (additionalStats['team1_yellow_cards'] !== undefined || additionalStats['team2_yellow_cards'] !== undefined) ? `\n**Amarillas por equipo:** ${match.team1.split(' (')[0]}: ${additionalStats['team1_yellow_cards'] || 0}, ${match.team2.split(' (')[0]}: ${additionalStats['team2_yellow_cards'] || 0}` : '';
           const teamRedCardsText = (additionalStats['team1_red_card'] || additionalStats['team2_red_card']) ? `\n**Rojas por equipo:** ${additionalStats['team1_red_card'] ? match.team1.split(' (')[0] : ''} ${additionalStats['team2_red_card'] ? match.team2.split(' (')[0] : ''}`.trim() : '';


           const manualResultEmbed = new Discord.EmbedBuilder()
               .setColor('#9900ff').setTitle('👤 Resultado Establecido Manualmente')
               .addFields(
                   { name: 'Partido', value: `${getTeamEmoji(match.team1)} ${match.team1.split(' (')[0]} vs ${match.team2.split(' (')[0]} ${getTeamEmoji(match.team2)}`, inline: false },
                   { name: 'Resultado Final', value: manualResultResponse.score + specialEventsText + cornersText + yellowCardsText + redCardsText + teamYellowCardsText + teamRedCardsText, inline: false },
                   { name: 'Ganador', value: winnerText, inline: true },
                   { name: 'Tipo', value: '👤 Resultado Manual', inline: true }
               );
           message.reply({ embeds: [manualResultEmbed] });
       } else { message.reply(`❌ ${manualResultResponse.message}`); }
       break;
   

        case '!misapuestas':
        case '!mybets':
            const userBets = Object.values(bets).filter(bet => bet.userId === message.author.id);
            if (userBets.length === 0) { message.reply('❌ No tienes apuestas registradas.'); return; }
            const betsText = userBets.slice(-10).map(bet => {
                const match = matches[bet.matchId];
                if (!match) return '❌ Partido eliminado';
                let predictionText;
                if (bet.betType === 'exact_score' && bet.exactScore) { predictionText = `Exacto ${bet.exactScore.home}-${bet.exactScore.away}`; }
                else if (bet.betType === 'special' && bet.description) { predictionText = bet.description; }
                else if (bet.betType === 'special_combined' && bet.description) { predictionText = bet.description; }
                else if (bet.prediction) { predictionText = bet.prediction === 'team1' ? match.team1.split(' (')[0] : bet.prediction === 'team2' ? match.team2.split(' (')[0] : 'Empate'; }
                else if (bet.description) { predictionText = bet.description; }
                else { predictionText = 'Apuesta especial'; }
                const statusEmoji = bet.status === 'won' ? '✅' : bet.status === 'lost' ? '❌' : '⏳';
                return `${statusEmoji} **${match.team1.split(' (')[0]} vs ${match.team2.split(' (')[0]}**\nPredicción: ${predictionText} | Cuota: ${bet.odds} | Apostado: ${bet.amount}`;
            }).join('\n\n');
            const myBetsEmbed = new Discord.EmbedBuilder().setColor('#9900ff').setTitle('📋 Tus Últimas Apuestas').setDescription(betsText);
            message.reply({ embeds: [myBetsEmbed] });
            break;

        case '!eliminarmatch':
        case '!deletematch':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            if (args.length < 2) { message.reply('❌ Uso: `!eliminarmatch <ID_partido>`\nEjemplo: `!eliminarmatch 1234567890`'); return; }
            const deleteMatchId = args[1];
            const deleteResult = await deleteMatch(deleteMatchId);
            if (deleteResult.success) {
                const deleteEmbed = new Discord.EmbedBuilder()
                    .setColor('#ff0000').setTitle('🗑️ Partido Eliminado')
                    .setDescription(deleteResult.message)
                    .addFields({ name: 'Partido eliminado', value: `${getTeamEmoji(deleteResult.match.team1)} ${deleteResult.match.team1.split(' (')[0]} vs ${deleteResult.match.team2.split(' (')[0]} ${getTeamEmoji(deleteResult.match.team2)}`, inline: false });
                message.reply({ embeds: [deleteEmbed] });
            } else message.reply(`❌ ${deleteResult.message}`);
            break;

        case '!limpiarpartidos':
        case '!clearmatches':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            const clearResult = await deleteAllUpcomingMatches();
            if (clearResult.success) {
                const clearEmbed = new Discord.EmbedBuilder()
                    .setColor('#ff0000').setTitle('🗑️ Partidos Eliminados')
                    .setDescription(clearResult.message)
                    .addFields(
                        { name: 'Partidos eliminados', value: `${clearResult.deletedCount}`, inline: true },
                        { name: 'Apuestas canceladas', value: `${clearResult.betsReturned}`, inline: true },
                        { name: 'Dinero devuelto', value: `${clearResult.moneyReturned}`, inline: true }
                    );
                message.reply({ embeds: [clearEmbed] });
            } else message.reply(`❌ ${clearResult.message}`);
            break;

        case '!limpiarhistorial':
        case '!clearhistory':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            const historyResult = await deleteFinishedMatches();
            if (historyResult.success) {
                const historyEmbed = new Discord.EmbedBuilder()
                    .setColor('#ff0000').setTitle('🗑️ Historial Limpiado')
                    .setDescription(historyResult.message)
                    .addFields({ name: 'Partidos eliminados del historial', value: `${historyResult.deletedCount}`, inline: true });
                message.reply({ embeds: [historyEmbed] });
            } else message.reply(`❌ ${historyResult.message}`);
            break;

        case '!actualizard1':
            message.reply('🔍 Obteniendo equipos de División 1...');
            const d1Data = await scrapeIOSoccerTeams('d1');
            if (d1Data && Object.keys(d1Data).length > 0) {
                teams = { ...teams, ...d1Data };
                await saveData();
                const embed = new Discord.EmbedBuilder()
                    .setColor('#00ff00').setTitle('✅ División 1 Actualizada')
                    .setDescription(`Se obtuvieron ${Object.keys(d1Data).length} equipos de IOSoccer`)
                    .addFields({ name: 'Equipos obtenidos:', value: Object.keys(d1Data).slice(0, 8).map(name => name.replace(' (D1)', '')).join('\n') + (Object.keys(d1Data).length > 8 ? '\n...' : '') })
                    .setFooter({ text: 'Usa !equipos para ver todos los equipos' });
                message.reply({ embeds: [embed] });
            } else message.reply('❌ No se pudieron obtener datos de División 1. Verifica la conexión a internet.');
            break;

        case '!actualizard2':
            message.reply('🔍 Obteniendo equipos de División 2...');
            const d2Data = await scrapeIOSoccerTeams('d2');
            if (d2Data && Object.keys(d2Data).length > 0) {
                teams = { ...teams, ...d2Data };
                await saveData();
                const embed = new Discord.EmbedBuilder()
                    .setColor('#00ff00').setTitle('✅ División 2 Actualizada')
                    .setDescription(`Se obtuvieron ${Object.keys(d2Data).length} equipos de IOSoccer`)
                    .addFields({ name: 'Equipos obtenidos:', value: Object.keys(d2Data).slice(0, 8).map(name => name.replace(' (D2)', '')).join('\n') + (Object.keys(d2Data).length > 8 ? '\n...' : '') })
                    .setFooter({ text: 'Usa !equipos para ver todos los equipos' });
                message.reply({ embeds: [embed] });
            } else message.reply('❌ No se pudieron obtener datos de División 2. Verifica la conexión a internet.');
            break;

        case '!actualizartorneo':
            if (args.length < 2) {
                const tournamentsText = Object.entries(TOURNAMENT_NAMES).map(([code, name]) => `• \`${code}\` - ${name}`).join('\n');
                message.reply(`❌ Uso: \`!actualizartorneo <código_torneo>\`\n\n**Torneos disponibles:**\n${tournamentsText}`);
                return;
            }
            const tournamentCode = args[1].toLowerCase();
            if (!TOURNAMENT_NAMES[tournamentCode]) { message.reply(`❌ Torneo "${tournamentCode}" no encontrado. Usa \`!actualizartorneo\` sin parámetros para ver la lista.`); return; }
            message.reply(`🔍 Obteniendo equipos de ${TOURNAMENT_NAMES[tournamentCode]}...`);
            const tournamentData = await scrapeIOSoccerTeams(tournamentCode);
            if (tournamentData && Object.keys(tournamentData).length > 0) {
                teams = { ...teams, ...tournamentData };
                await saveData();
                const embed = new Discord.EmbedBuilder()
                    .setColor('#00ff00').setTitle(`✅ ${TOURNAMENT_NAMES[tournamentCode]} Actualizado`)
                    .setDescription(`Se obtuvieron ${Object.keys(tournamentData).length} equipos de IOSoccer`)
                    .addFields({ name: 'Equipos obtenidos:', value: Object.keys(tournamentData).slice(0, 8).map(name => name.replace(/ \([^)]+\)/, '')).join('\n') + (Object.keys(tournamentData).length > 8 ? '\n...' : '') })
                    .setFooter({ text: 'Usa !equipos para ver todos los equipos' });
                message.reply({ embeds: [embed] });
            } else { message.reply(`❌ No se pudieron obtener datos de ${TOURNAMENT_NAMES[tournamentCode]}. Verifica la conexión a internet.`); }
            break;

        case '!actualizartodo':
        case '!updateall':
            message.reply('🔍 Obteniendo todos los equipos de IOSoccer... Esto puede tomar unos segundos.');
            const allData = await scrapeAllLeagues();
            if (allData && Object.keys(allData).length > 0) {
                teams = { ...teams, ...allData };
                await saveData();
                const d1Count = Object.keys(allData).filter(name => name.includes('(D1)')).length;
                const d2Count = Object.keys(allData).filter(name => name.includes('(D2)')).length;
                const embed = new Discord.EmbedBuilder()
                    .setColor('#00ff00').setTitle('✅ Todas las Ligas IOSoccer Actualizadas')
                    .addFields(
                        { name: 'División 1', value: `${d1Count} equipos`, inline: true },
                        { name: 'División 2', value: `${d2Count} equipos`, inline: true },
                        { name: 'Total', value: `${Object.keys(allData).length} equipos`, inline: true }
                    ).setFooter({ text: 'Usa !equipos para ver la lista completa' });
                message.reply({ embeds: [embed] });
            } else message.reply('❌ No se pudieron obtener datos de IOSoccer. Verifica la conexión a internet.');
            break;

        case '!limpiarequipos':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            teams = {};
            await saveData();
            message.reply('🗑️ Se eliminaron todos los equipos. Usa `!actualizartodo` para obtener equipos de IOSoccer.');
            break;

        case '!ayuda_apuestas':
        case '!help':
            const helpEmbed = new Discord.EmbedBuilder()
                .setColor('#0099ff').setTitle('🤖 Bot de Apuestas IOSoccer - Guía de Comandos')
                .setDescription('**¡Bienvenido al bot de apuestas con datos reales de IOSoccer Sudamérica!**\nAquí tienes todos los comandos organizados por categorías:')
                .addFields(
                    { name: '💰 **MI PERFIL Y DINERO**', value: '`!balance` - Ver tu dinero, apuestas ganadas/perdidas y estadísticas\n`!misapuestas` - Ver tus últimas 10 apuestas con resultados\n`!dar @usuario <cantidad>` - Transferir dinero a otro jugador', inline: false },
                    { name: '🏆 **EQUIPOS Y TORNEOS**', value: '`!equipos` - Ver todos los equipos organizados por torneo\n`!equipo <nombre>` - Ver estadísticas detalladas de un equipo\n`!comparar <equipo1> vs <equipo2>` - Comparar dos equipos\n`!actualizartodo` - Actualizar equipos desde IOSoccer (todas las ligas)\n`!actualizartorneo <código>` - Actualizar torneo específico (d1, d2, maradei, etc.)', inline: false },
                    { name: '⚽ **PARTIDOS**', value: '`!partidos` - Ver todos los partidos disponibles para apostar\n`!crearmatch "Equipo1" vs "Equipo2"` - Crear partido personalizado\n`!crearmatch "Boca" vs "River" d1` - Crear partido de torneo específico\n`!generarmatch` - Generar partido aleatorio automático', inline: false },
                    { name: '💵 **APUESTAS BÁSICAS**', value: '`!apostar <ID> team1 <cantidad>` - Apostar por victoria del primer equipo\n`!apostar <ID> draw <cantidad>` - Apostar por empate\n`!apostar <ID> team2 <cantidad>` - Apostar por victoria del segundo equipo\n`!cuotas <ID>` - Ver todas las cuotas disponibles de un partido', inline: false },
                    { name: '🎯 **APUESTAS ESPECIALES**', value: '`!apostarespecial <ID> exacto-X-Y <cantidad>` - Resultado exacto (ej: exacto-2-1)\n`!apostarespecial <ID> ambos-marcan <cantidad>` - Ambos equipos marcan\n`!apostarespecial <ID> mas-2-5 <cantidad>` - Más de 2.5 goles\n`!apostarespecial <ID> menos-2-5 <cantidad>` - Menos de 2.5 goles\n`!apostarespecial <ID> mas-X-5-corners <cantidad>` - Más de X.5 córners (ej: mas-4-5-corners)\n`!apostarespecial <ID> menos-X-5-corners <cantidad>` - Menos de X.5 córners (ej: menos-2-5-corners)\n`!apostarespecial <ID> corner <cantidad>` - Habrá gol de córner\n`!apostarespecial <ID> libre <cantidad>` - Habrá gol de tiro libre\n`!apostarespecial <ID> chilena <cantidad>` - Habrá gol de chilena\n`!apostarespecial <ID> cabeza <cantidad>` - Habrá gol de cabeza\n`!apostarespecial <ID> delantero <cantidad>` - Gol de delantero\n`!apostarespecial <ID> medio <cantidad>` - Gol de mediocampista\n`!apostarespecial <ID> defensa <cantidad>` - Gol de defensa\n`!apostarespecial <ID> arquero <cantidad>` - Gol de arquero', inline: false },
                    { name: '🎮 **RESULTADOS**', value: '`!simular <ID>` - Simular automáticamente el resultado de un partido\n`!actualizar_resultados` - Actualiza la forma de los equipos con resultados reales (Admin)', inline: false },
                    { name: '🏅 **CÓDIGOS DE TORNEOS**', value: '**Ligas:** `d1` `d2` `d3`\n**Copas:** `maradei` `cv` `cd2` `cd3` `izoro` `izplata`\n*Ejemplo: !crearmatch "Racing" vs "Independiente" maradei*', inline: false },
                    { name: '⚙️ **ADMINISTRACIÓN** *(Solo Admin)*', value: '`!admindar @usuario <cantidad>` - Dar dinero gratis\n`!addadmin @usuario` - Añadir un nuevo administrador\n`!pausarapuestas` - Pausar todas las nuevas apuestas\n`!reanudarapuestas` - Reanudar las apuestas\n`!setodds <ID> <cuota1> <cuotaX> <cuota2>` - Establecer cuotas manuales para un partido\n`!resultado <ID> team1 2 1 [especiales]` - Establecer resultado manual\n`!eliminarmatch <ID>` - Eliminar partido específico\n`!limpiarpartidos` - Eliminar todos los partidos pendientes\n`!limpiarhistorial` - Limpiar partidos terminados\n`!limpiarequipos` - Eliminar todos los equipos registrados', inline: false }
                ).setFooter({ text: '💡 Tip: Los equipos y posiciones se actualizan automáticamente desde IOSoccer • Las copas eliminatorias no muestran forma WDL', iconURL: client.user.avatarURL() }).setTimestamp();
            message.reply({ embeds: [helpEmbed] });
            break;

           // ... (código existente) ...
   case '!cuotas':
   case '!odds':
       if (args.length < 2) { message.reply('❌ Uso: `!cuotas <ID_partido>`\nEjemplo: `!cuotas 1234567890`'); return; }
       const oddsMatchId = args[1];
       const oddsMatch = matches[oddsMatchId];
       if (!oddsMatch) { message.reply('❌ No existe un partido con ese ID.'); return; }
       const exactScores = {
           '0-0': calculateExactScoreOdds(oddsMatch, { home: 0, away: 0 }), '1-0': calculateExactScoreOdds(oddsMatch, { home: 1, away: 0 }),
           '0-1': calculateExactScoreOdds(oddsMatch, { home: 0, away: 1 }), '1-1': calculateExactScoreOdds(oddsMatch, { home: 1, away: 1 }),
           '2-0': calculateExactScoreOdds(oddsMatch, { home: 2, away: 0 }), '0-2': calculateExactScoreOdds(oddsMatch, { home: 0, away: 2 }),
           '2-1': calculateExactScoreOdds(oddsMatch, { home: 2, away: 1 }), '1-2': calculateExactScoreOdds(oddsMatch, { home: 1, away: 2 }),
           '2-2': calculateExactScoreOdds(oddsMatch, { home: 2, away: 2 })
       };
       const specialOdds = {
           'Ambos marcan': calculateSpecialOdds(oddsMatch, 'both_teams_score'), 'Más de 2.5 goles': calculateSpecialOdds(oddsMatch, 'total_goals_over_2_5'),
           'Menos de 2.5 goles': calculateSpecialOdds(oddsMatch, 'total_goals_under_2_5'), 'home_goals_over_1_5': calculateSpecialOdds(oddsMatch, 'home_goals_over_1_5'),
           'Más de 1.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_over_1_5'),
           'Más de 2.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_over_2_5'),
           'Más de 3.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_over_3_5'),
           'Más de 4.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_over_4_5'),
           'Más de 5.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_over_5_5'),
           'Más de 6.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_over_6_5'),
           'Más de 7.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_over_7_5'),
           'Más de 8.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_over_8_5'),
           'Menos de 1.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_under_1_5'),
           'Menos de 2.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_under_2_5'),
           'Menos de 3.5 córners': calculateSpecialOdds(oddsMatch, 'total_corners_under_3_5'),
           'Gol de córner': calculateSpecialOdds(oddsMatch, 'corner_goal'),
           'Gol de tiro libre': calculateSpecialOdds(oddsMatch, 'free_kick_goal'), 'Gol de chilena': calculateSpecialOdds(oddsMatch, 'bicycle_kick_goal'),
           'Gol de cabeza': calculateSpecialOdds(oddsMatch, 'header_goal'), 'Gol de delantero': calculateSpecialOdds(oddsMatch, 'striker_goal'),
           'Gol de mediocampista': calculateSpecialOdds(oddsMatch, 'midfielder_goal'), 'Gol de defensa': calculateSpecialOdds(oddsMatch, 'defender_goal'),
           'Gol de arquero': calculateSpecialOdds(oddsMatch, 'goalkeeper_goal'),
           // --- Nuevas cuotas para tarjetas ---
           'Más de 2.5 amarillas totales': calculateSpecialOdds(oddsMatch, 'total_yellow_cards_over_2_5'),
           'Más de 3.5 amarillas totales': calculateSpecialOdds(oddsMatch, 'total_yellow_cards_over_3_5'),
           'Más de 4.5 amarillas totales': calculateSpecialOdds(oddsMatch, 'total_yellow_cards_over_4_5'),
           'Habrá tarjeta roja': calculateSpecialOdds(oddsMatch, 'total_red_cards_yes'),
           'No habrá tarjeta roja': calculateSpecialOdds(oddsMatch, 'total_red_cards_no'),
           [`Más de 1.5 amarillas ${oddsMatch.team1.split(' (')[0]}`]: calculateSpecialOdds(oddsMatch, 'team1_yellow_cards_over_1_5'),
           [`Más de 1.5 amarillas ${oddsMatch.team2.split(' (')[0]}`]: calculateSpecialOdds(oddsMatch, 'team2_yellow_cards_over_1_5'),
           [`Roja para ${oddsMatch.team1.split(' (')[0]}`]: calculateSpecialOdds(oddsMatch, 'team1_red_card_yes'),
           [`Roja para ${oddsMatch.team2.split(' (')[0]}`]: calculateSpecialOdds(oddsMatch, 'team2_red_card_yes'),
       };
       const exactScoreText = Object.entries(exactScores).map(([score, odds]) => `${score}: ${odds}`).join(' • ');
       const specialText = Object.entries(specialOdds).map(([name, odds]) => `**${name}**: ${odds}`).join('\n');
       const oddsEmbed = new Discord.EmbedBuilder()
           .setColor('#ff9900').setTitle(`📊 Cuotas Completas - ${oddsMatch.team1.split(' (')[0]} vs ${oddsMatch.team2.split(' (')[0]}`)
           .addFields(
               { name: '⚽ Resultado', value: `**${oddsMatch.team1.split(' (')[0]}**: ${oddsMatch.odds.team1}\n**Empate**: ${oddsMatch.odds.draw}\n**${oddsMatch.team2.split(' (')[0]}**: ${oddsMatch.odds.team2}`, inline: false },
               { name: '🎯 Resultados Exactos', value: exactScoreText, inline: false },
               { name: '🏆 Apuestas Especiales', value: specialText, inline: false }
           ).setFooter({ text: 'Usa !apostarespecial para apostar en estos mercados' });
       message.reply({ embeds: [oddsEmbed] });
       break;
   

        case '!actualizar_resultados':
        case '!updateresults':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            message.reply('🔍 Iniciando actualización de resultados desde IOSoccer... Esto puede tomar unos minutos.');
            try {
                const results = await scrapeIOSoccerResults(8);
                if (results.length === 0) { message.reply('❌ No se pudieron obtener resultados. Verifica la conexión o la estructura del sitio.'); return; }
                const teamStats = analyzeTeamPerformance(results);
                const updatedCount = await updateTeamsWithRealResults(teamStats);
                const { surprises, bigWins } = analyzeResultSurprises(results, teamStats);
                const topScorers = bigWins.slice(0, 5).map(bw => `• **${bw.winner}** ${bw.score} ${bw.loser} (${bw.goalDifference} goles de diferencia)`).join('\n') || 'No se encontraron goleadas significativas';
                const resultEmbed = new Discord.EmbedBuilder()
                    .setColor('#00ff00').setTitle('✅ Resultados Actualizados desde IOSoccer')
                    .addFields(
                        { name: 'Resultados procesados', value: `${results.length}`, inline: true },
                        { name: 'Equipos actualizados', value: `${updatedCount}`, inline: true },
                        { name: 'Goleadas detectadas', value: `${bigWins.length}`, inline: true },
                        { name: '🔥 Goleadas más destacadas', value: topScorers, inline: false }
                    ).setFooter({ text: 'Los equipos ahora tienen forma reciente basada en resultados reales' }).setTimestamp();
                message.reply({ embeds: [resultEmbed] });
            } catch (error) { console.error('❌ Error actualizando resultados:', error); message.reply('❌ Error al actualizar resultados. Revisa los logs para más detalles.'); }
            break;

        case '!equipo':
        case '!teamstats':
            if (args.length < 2) { message.reply('❌ Uso: `!equipo <nombre_equipo>`\nEjemplo: `!equipo Aimstar`'); return; }
            const teamQuery = args.slice(1).join(' ');
            const teamStats = getTeamDetailedStats(teamQuery);
            if (!teamStats) {
                const suggestions = getTeamSuggestions(teamQuery, 3);
                let suggestionText = `❌ No se encontró el equipo "${teamQuery}".`;
                if (suggestions.length > 0) { suggestionText += '\n\n**¿Quisiste decir?**\n' + suggestions.map(s => `• **${s.name}** (${s.tournament} - Pos. ${s.position})`).join('\n'); }
                message.reply(suggestionText);
                return;
            }
            let statsText = `**Liga:** ${teamStats.tournament}\n`;
            statsText += `**Posición:** ${teamStats.position} | `;
            statsText += `**Forma reciente:** ${teamStats.form} (${teamStats.formAnalysis.wins}W-${teamStats.formAnalysis.draws}D-${teamStats.formAnalysis.losses}L)\n`;
            statsText += `**Puntos en últimos 5:** ${teamStats.formAnalysis.points}/15 (${teamStats.formAnalysis.percentage}%)\n`;
            if (teamStats.realStats) {
                statsText += `\n**📊 Estadísticas Reales:**\n`;
                statsText += `Partidos: ${teamStats.realStats.matches} | `;
                statsText += `Récord: ${teamStats.realStats.wins}W-${teamStats.realStats.draws}D-${teamStats.realStats.losses}L\n`;
                statsText += `Goles: ${teamStats.realStats.goalsFor} a favor, ${teamStats.realStats.goalsAgainst} en contra\n`;
                statsText += `Promedio: ${teamStats.realStats.averageGoalsFor} por partido\n`;
                statsText += `Efectividad: ${teamStats.realStats.winRate}%\n`;
                statsText += `*Última actualización: ${new Date(teamStats.realStats.lastUpdated).toLocaleDateString()}*`;
            }
            const teamEmbed = new Discord.EmbedBuilder()
                .setColor('#0099ff').setTitle(`📊 ${teamStats.name}`)
                .setDescription(statsText)
                .setFooter({ text: 'Usa !actualizar_resultados para obtener estadísticas más precisas' });
            message.reply({ embeds: [teamEmbed] });
            break;

        case '!comparar':
        case '!compare':
            if (args.length < 4 || !args.includes('vs')) { message.reply('❌ Uso: `!comparar <equipo1> vs <equipo2>`\nEjemplo: `!comparar "Aimstar" vs "Deportivo Tarrito"`'); return; }
            const compareCommand = message.content.slice(command.length).trim();
            const compareVsIndex = compareCommand.toLowerCase().indexOf(' vs ');
            const compareTeam1Input = compareCommand.slice(0, compareVsIndex).trim().replace(/"/g, '');
            const compareTeam2Input = compareCommand.slice(compareVsIndex + 4).trim().replace(/"/g, '');
            const compareTeam1Stats = getTeamDetailedStats(compareTeam1Input);
            const compareTeam2Stats = getTeamDetailedStats(compareTeam2Input);
            if (!compareTeam1Stats || !compareTeam2Stats) { message.reply('❌ No se encontró uno de los equipos para comparar.'); return; }
            let advantages = [];
            if (compareTeam1Stats.position < compareTeam2Stats.position) { advantages.push(`📈 **${compareTeam1Stats.name}** está mejor posicionado (${compareTeam1Stats.position}° vs ${compareTeam2Stats.position}°)`); }
            else if (compareTeam2Stats.position < compareTeam1Stats.position) { advantages.push(`📈 **${compareTeam2Stats.name}** está mejor posicionado (${compareTeam2Stats.position}° vs ${compareTeam1Stats.position}°)`); }
            if (compareTeam1Stats.formAnalysis.points > compareTeam2Stats.formAnalysis.points) { advantages.push(`🔥 **${compareTeam1Stats.name}** tiene mejor forma reciente (${compareTeam1Stats.formAnalysis.points} vs ${compareTeam2Stats.formAnalysis.points} puntos)`); }
            else if (compareTeam2Stats.formAnalysis.points > compareTeam1Stats.formAnalysis.points) { advantages.push(`🔥 **${compareTeam2Stats.name}** tiene mejor forma reciente (${compareTeam2Stats.formAnalysis.points} vs ${compareTeam1Stats.formAnalysis.points} puntos)`); }
            if (compareTeam1Stats.league !== compareTeam2Stats.league) {
                if (compareTeam1Stats.league === 'D1' && compareTeam2Stats.league === 'D2') { advantages.push(`⭐ **${compareTeam1Stats.name}** juega en una liga superior (D1 vs D2)`); }
                else if (compareTeam2Stats.league === 'D1' && compareTeam1Stats.league === 'D2') { advantages.push(`⭐ **${compareTeam2Stats.name}** juega en una liga superior (D1 vs D2)`); }
            }
            const comparisonText = `**${compareTeam1Stats.name}** (${compareTeam1Stats.tournament})\n` + `Posición: ${compareTeam1Stats.position} | Forma: ${compareTeam1Stats.form} (${compareTeam1Stats.formAnalysis.points} pts)\n\n` + `**${compareTeam2Stats.name}** (${compareTeam2Stats.tournament})\n` + `Posición: ${compareTeam2Stats.position} | Forma: ${compareTeam2Stats.form} (${compareTeam2Stats.formAnalysis.points} pts)\n\n` + `**Análisis:**\n${advantages.join('\n') || 'Equipos muy parejos'}`;
            const compareEmbed = new Discord.EmbedBuilder()
                .setColor('#9900ff').setTitle(`⚖️ Comparación de Equipos`)
                .setDescription(comparisonText)
                .setFooter({ text: 'Usa !crearmatch para crear un partido entre estos equipos' });
            message.reply({ embeds: [compareEmbed] });
            break;

           // ... (código existente) ...
   case '!apostarespecial':
   case '!betspecial':
       if (bettingPaused) { message.reply('❌ Las apuestas están actualmente pausadas por un administrador.'); return; }
       if (args.length < 4) {
           message.reply(`❌ **Uso:** \`!apostarespecial <ID_partido> <tipo> <cantidad>\`\n\n**Tipos disponibles:**\n- \`exacto-X-Y\`\n- \`ambos-marcan\`\n- \`mas-2-5\`\n- \`menos-2-5\`\n- \`mas-X-5-corners\` (ej: mas-4-5-corners)\n- \`menos-X-5-corners\` (ej: menos-2-5-corners)\n- \`corner\`\n- \`libre\`\n- \`chilena\`\n- \`cabeza\`\n- \`delantero\`\n- \`medio\`\n- \`defensa\`\n- \`arquero\`\n- \`amarillas-mas-X-5\` (ej: amarillas-mas-2-5)\n- \`roja-si\`\n- \`roja-no\`\n- \`amarillas1-mas-1-5\` (equipo 1)\n- \`amarillas2-mas-1-5\` (equipo 2)\n- \`roja1\` (equipo 1)\n- \`roja2\` (equipo 2)\n\n**Ejemplo:** \`!apostarespecial 1234567890 exacto-2-1 100\``);
           return;
       }
       const specialMatchId = args[1];
       const specialType = args[2].toLowerCase();
       const specialAmount = parseFloat(args[3]);
       const specialMatch = matches[specialMatchId];
       if (!specialMatch) { message.reply('❌ No existe un partido con ese ID.'); return; }
       if (specialMatch.status !== 'upcoming') { message.reply('❌ No puedes apostar en un partido que ya terminó.'); return; }
       if (isNaN(specialAmount) || specialAmount <= 0) { message.reply('❌ La cantidad debe ser un número mayor a 0.'); return; }
       if (userData[message.author.id].balance < specialAmount) { message.reply('❌ No tienes suficiente dinero para esta apuesta.'); return; }
       let betOdds, betDescription, betData;
       if (specialType.startsWith('exacto-')) {
           const scoreParts = specialType.split('-');
           if (scoreParts.length !== 3) { message.reply('❌ Formato incorrecto para resultado exacto. Usa: exacto-X-Y (ej: exacto-2-1)'); return; }
           const home = parseInt(scoreParts[1]);
           const away = parseInt(scoreParts[2]);
           if (isNaN(home) || isNaN(away) || home < 0 || away < 0) { message.reply('❌ Los goles deben ser números válidos (0 o mayor).'); return; }
           betOdds = calculateExactScoreOdds(specialMatch, { home, away });
           betDescription = `Resultado exacto ${home}-${away}`;
           betData = { type: 'exact_score', exactScore: { home, away } };
       } else {
           const specialTypesMap = {
               'ambos-marcan': 'both_teams_score', 'mas-2-5': 'total_goals_over_2_5', 'menos-2-5': 'total_goals_under_2_5',
               'mas-1-5-corners': 'total_corners_over_1_5',
               'mas-2-5-corners': 'total_corners_over_2_5',
               'mas-3-5-corners': 'total_corners_over_3_5',
               'mas-4-5-corners': 'total_corners_over_4_5',
               'mas-5-5-corners': 'total_corners_over_5_5',
               'mas-6-5-corners': 'total_corners_over_6_5',
               'mas-7-5-corners': 'total_corners_over_7_5',
               'mas-8-5-corners': 'total_corners_over_8_5',
               'menos-1-5-corners': 'total_corners_under_1_5',
               'menos-2-5-corners': 'total_corners_under_2_5',
               'menos-3-5-corners': 'total_corners_under_3_5',
               'corner': 'corner_goal', 'libre': 'free_kick_goal', 'chilena': 'bicycle_kick_goal', 'cabeza': 'header_goal',
               'delantero': 'striker_goal', 'medio': 'midfielder_goal', 'defensa': 'defender_goal', 'arquero': 'goalkeeper_goal',
               // --- Nuevos tipos para tarjetas ---
               'amarillas-mas-2-5': 'total_yellow_cards_over_2_5',
               'amarillas-mas-3-5': 'total_yellow_cards_over_3_5',
               'amarillas-mas-4-5': 'total_yellow_cards_over_4_5',
               'roja-si': 'total_red_cards_yes',
               'roja-no': 'total_red_cards_no',
               'amarillas1-mas-1-5': 'team1_yellow_cards_over_1_5',
               'amarillas2-mas-1-5': 'team2_yellow_cards_over_1_5',
               'roja1': 'team1_red_card_yes',
               'roja2': 'team2_red_card_yes',
           };
           const specialNamesMap = {
               'ambos-marcan': 'Ambos equipos marcan', 'mas-2-5': 'Más de 2.5 goles', 'menos-2-5': 'Menos de 2.5 goles',
               'mas-1-5-corners': 'Más de 1.5 córners',
               'mas-2-5-corners': 'Más de 2.5 córners',
               'mas-3-5-corners': 'Más de 3.5 córners',
               'mas-4-5-corners': 'Más de 4.5 córners',
               'mas-5-5-corners': 'Más de 5.5 córners',
               'mas-6-5-corners': 'Más de 6.5 córners',
               'mas-7-5-corners': 'Más de 7.5 córners',
               'mas-8-5-corners': 'Más de 8.5 córners',
               'menos-1-5-corners': 'Menos de 1.5 córners',
               'menos-2-5-corners': 'Menos de 2.5 córners',
               'menos-3-5-corners': 'Menos de 3.5 córners',
               'corner': 'Gol de córner', 'libre': 'Gol de tiro libre', 'chilena': 'Gol de chilena', 'cabeza': 'Gol de cabeza',
               'delantero': 'Gol de delantero', 'medio': 'Gol de mediocampista', 'defensa': 'Gol de defensa', 'arquero': 'Gol de arquero',
               // --- Nuevos nombres para tarjetas ---
               'amarillas-mas-2-5': 'Más de 2.5 tarjetas amarillas totales',
               'amarillas-mas-3-5': 'Más de 3.5 tarjetas amarillas totales',
               'amarillas-mas-4-5': 'Más de 4.5 tarjetas amarillas totales',
               'roja-si': 'Habrá tarjeta roja',
               'roja-no': 'No habrá tarjeta roja',
               'amarillas1-mas-1-5': `Más de 1.5 tarjetas amarillas ${specialMatch.team1.split(' (')[0]}`,
               'amarillas2-mas-1-5': `Más de 1.5 tarjetas amarillas ${specialMatch.team2.split(' (')[0]}`,
               'roja1': `Tarjeta roja para ${specialMatch.team1.split(' (')[0]}`,
               'roja2': `Tarjeta roja para ${specialMatch.team2.split(' (')[0]}`,
           };
           if (!specialTypesMap[specialType]) { message.reply('❌ Tipo de apuesta especial no válido. Usa `!apostarespecial` sin parámetros para ver la lista.'); return; }
           betOdds = calculateSpecialOdds(specialMatch, specialTypesMap[specialType]);
           betDescription = specialNamesMap[specialType];
           betData = { type: 'special', specialType: specialTypesMap[specialType] };
       }
       const specialBetId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
       bets[specialBetId] = {
           id: specialBetId, userId: message.author.id, matchId: specialMatchId, amount: specialAmount, odds: betOdds,
           status: 'pending', timestamp: new Date().toISOString(), betType: betData.type, description: betDescription, ...betData
       };
       userData[message.author.id].balance -= specialAmount;
       userData[message.author.id].totalBets++;
       if (!specialMatch.bets) specialMatch.bets = [];
       specialMatch.bets.push(specialBetId);
       await saveData();
       broadcastUpdate('new-bet', { matchId: specialMatchId, userId: message.author.id, amount: specialAmount });
       const specialBetEmbed = new Discord.EmbedBuilder()
           .setColor('#9900ff').setTitle('🎯 Apuesta Especial Realizada')
           .addFields(
               { name: 'Partido', value: `${specialMatch.team1.split(' (')[0]} vs ${specialMatch.team2.split(' (')[0]}`, inline: false },
               { name: 'Apuesta', value: betDescription, inline: true },
               { name: 'Cantidad apostada', value: `${specialAmount}`, inline: true },
               { name: 'Cuota', value: betOdds.toString(), inline: true },
               { name: 'Ganancia potencial', value: `${Math.round(specialAmount * betOdds)}`, inline: true },
               { name: 'Balance restante', value: `${userData[message.author.id].balance}`, inline: true }
           );
       message.reply({ embeds: [specialBetEmbed] });
       break;

        case '!pausarapuestas':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            bettingPaused = true;
            message.reply('⏸️ Todas las nuevas apuestas han sido pausadas.');
            break;

        case '!reanudarapuestas':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            bettingPaused = false;
            message.reply('▶️ Las apuestas han sido reanudadas.');
            break;

        case '!setodds':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            if (args.length < 5) { message.reply('❌ Uso: `!setodds <ID_partido> <cuota_equipo1> <cuota_empate> <cuota_equipo2>`\nEjemplo: `!setodds 1234567890 1.50 3.00 4.50`'); return; }
            const setOddsMatchId = args[1];
            const newOddsTeam1 = parseFloat(args[2]);
            const newOddsDraw = parseFloat(args[3]);
            const newOddsTeam2 = parseFloat(args[4]);
            const targetMatch = matches[setOddsMatchId];
            if (!targetMatch) { message.reply('❌ No existe un partido con ese ID.'); return; }
            if (targetMatch.status !== 'upcoming') { message.reply('❌ No puedes cambiar las cuotas de un partido que ya terminó.'); return; }
            if (isNaN(newOddsTeam1) || isNaN(newOddsDraw) || isNaN(newOddsTeam2) || newOddsTeam1 <= 0 || newOddsDraw <= 0 || newOddsTeam2 <= 0) { message.reply('❌ Las cuotas deben ser números válidos y mayores a 0.'); return; }
            targetMatch.odds = { team1: newOddsTeam1, draw: newOddsDraw, team2: newOddsTeam2 };
            await saveData();
            const setOddsEmbed = new Discord.EmbedBuilder()
                .setColor('#00ffff').setTitle('📊 Cuotas Actualizadas Manualmente')
                .addFields(
                    { name: 'Partido', value: `${targetMatch.team1.split(' (')[0]} vs ${targetMatch.team2.split(' (')[0]}`, inline: false },
                    { name: 'Nuevas Cuotas', value: `**${targetMatch.team1.split(' (')[0]}**: ${targetMatch.odds.team1}\n**Empate**: ${targetMatch.odds.draw}\n**${targetMatch.team2.split(' (')[0]}**: ${targetMatch.odds.team2}`, inline: false }
                );
            message.reply({ embeds: [setOddsEmbed] });
            break;

        case '!addadmin':
            if (!isAdmin(message.author.id)) { message.reply('❌ No tienes permisos para usar este comando.'); return; }
            if (args.length < 2) { message.reply('❌ Uso: `!addadmin <@usuario>`'); return; }
            const userToAdd = message.mentions.users.first();
            if (!userToAdd) { message.reply('❌ Debes mencionar a un usuario válido.'); return; }
            if (userToAdd.bot) { message.reply('❌ No puedes añadir un bot como administrador.'); return; }
            if (isAdmin(userToAdd.id)) { message.reply(`⚠️ ${userToAdd.username} ya es un administrador.`); return; }
            adminIds.push(userToAdd.id); // Esto solo lo añade en memoria. Para persistencia, se necesitaría un archivo de configuración o base de datos.
            message.reply(`✅ ${userToAdd.username} ha sido añadido como administrador.`);
            break;
    }
});

// --- Inicio del Servidor y Bot ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 Servidor web ejecutándose en puerto ${PORT}`));
client.on('ready', async () => {
    console.log(`Bot conectado como ${client.user.tag}!`);
    await connectDB(); // Conectar a MongoDB al iniciar el bot
});

client.login(process.env.BOT_TOKEN);
