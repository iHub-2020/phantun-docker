document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg');
    const btn = e.target.querySelector('button');

    // Reset UI
    errorMsg.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            window.location.href = '/';
        } else {
            errorMsg.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    } catch (err) {
        console.error('Login error:', err);
        errorMsg.textContent = 'Connection error';
        errorMsg.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
});
