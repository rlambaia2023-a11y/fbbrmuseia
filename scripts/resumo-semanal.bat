@echo off
cd /d C:\odontologiamuse\correcao-provas
if not exist logs mkdir logs
node scripts\resumo-semanal.js >> logs\resumo-semanal.log 2>&1
