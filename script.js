// ملف script.js المحدث
const API_URL = 'https://youtube-summarizer.vercel.app/api/summarize';

async function summarizeVideo() {
    const urlInput = document.getElementById('youtube-url');
    const resultDiv = document.getElementById('result');
    
    if (!urlInput.value) {
        alert('الرجاء إدخال رابط YouTube');
        return;
    }

    resultDiv.innerHTML = 'جاري التلخيص... ⏳';
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: urlInput.value })
        });
        
        const data = await response.json();
        
        if (data.error) {
            resultDiv.innerHTML = `❌ خطأ: ${data.error}`;
        } else {
            resultDiv.innerHTML = `
                <h3>📝 التلخيص:</h3>
                <p>${data.summary || data.transcript}</p>
                ${data.keyPoints ? `
                    <h4>🔑 النقاط الرئيسية:</h4>
                    <ul>${data.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul>
                ` : ''}
            `;
        }
    } catch (error) {
        resultDiv.innerHTML = '❌ فشل الاتصال بالسيرفر';
    }
}