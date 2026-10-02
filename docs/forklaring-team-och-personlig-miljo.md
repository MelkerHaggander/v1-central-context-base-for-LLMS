# Förklaring: personlig miljö och teammiljö

Det här är vad som har byggts, med vanliga ord.

Det finns två slags platser för minnen.

Din egen plats. Bara du är medlem. Där ligger det som gäller dig.

Teamets plats. Där är Alfredo, Filip och Melker medlemmar. Alla tre får läsa och ändra. Ingen har mer rätt än de andra.

Varje minne pekar på en plats. Filips dashboard har en vy. Växeln frågar servern vilka platser du är med i och byter sedan vilken hög som visas. Växeln själv är inte byggd här.

Listan som växeln frågar efter är ny. Den heter `GET /api/spaces`. Den kräver att du är inloggad. Den tar inte emot ett användar-id från webbläsaren. Den tittar bara på vem som är inloggad och lämnar tillbaka den personens egen plats och teamets plats. Filips egen plats kommer inte med i Alfredos lista.

En ny fil, `supabase/manual/20261005_space_members.sql`, beskriver medlemskapen. Den är inte körd. Den raderar inga minnen. Den ska köras av Alfredo när v1.2 integreras, efter filen som skapar tabellerna.

Claude får fortfarande läsa din plats och teamets plats när du ber om hjälp. Den vägen fanns redan i Melkers hjärna. Den här ändringen lägger inte till vektorsökning och rör inte den riktiga databasen.
