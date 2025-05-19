You've got multiple entry points where user.email could be undefined, especially:

When LinkedIn returns only a partial profile via OpenID (missing email)

When you fall back to the me endpoint without calling the separate email endpoint (/v2/emailAddress)

You have this line in your fallback handler:

js
Copy
Edit
email: null, // Email might not be available without additional API calls
And this one:

js
Copy
Edit
email: decodedToken.email || ''
So if LinkedIn didn’t return the email, your JWT ends up missing email, and therefore:

req.user.email is undefined

Upsert silently fails

Supabase: No user found

