[![YNAB Logo](https://api.ynab.com/papi/logo_api_meadow.svg)](https://api.ynab.com/)

- [Documentation](https://api.ynab.com/)
- [Endpoints](https://api.ynab.com/v1)
- [Status](https://ynabstatus.com/)
- [YNAB App](https://app.ynab.com/)

- [Hello Developers](https://api.ynab.com/#hello)
- [Quick Start](https://api.ynab.com/#quick-start)

##### Authentication

- [Overview](https://api.ynab.com/#authentication)
- [Personal Access Tokens](https://api.ynab.com/#personal-access-tokens)
- [OAuth Applications](https://api.ynab.com/#oauth-applications)
- [Access Token Usage](https://api.ynab.com/#access-token-usage)

##### Usage

- [Overview](https://api.ynab.com/#usage-overview)
- [Best Practices](https://api.ynab.com/#best-practices)
- [Endpoints](https://api.ynab.com/#endpoints)
- [Response Format](https://api.ynab.com/#response-format)
- [Errors](https://api.ynab.com/#errors)
- [Data Formats](https://api.ynab.com/#formats)
- [Delta Requests](https://api.ynab.com/#deltas)
- [Rate Limiting](https://api.ynab.com/#rate-limiting)

##### Libraries

- [JavaScript](https://api.ynab.com/#client-javascript)
- [Ruby](https://api.ynab.com/#client-ruby)
- [Python](https://api.ynab.com/#client-python)
- [Community](https://api.ynab.com/#clients-community)

##### Works with YNAB

- [Official](https://api.ynab.com/#works-with-ynab-official)
- [Third Party](https://api.ynab.com/#works-with-ynab-third-party)

##### Legal

- [Terms of Service](https://api.ynab.com/#terms)
- [OAuth Requirements](https://api.ynab.com/#oauth-requirements)

##### Changelog

- [v1.79.0](https://api.ynab.com/#v1.79.0)
- [v1.78.0](https://api.ynab.com/#v1.78.0)
- [v1.77.0](https://api.ynab.com/#v1.77.0)
- [v1.76.0](https://api.ynab.com/#v1.76.0)
- [v1.75.0](https://api.ynab.com/#v1.75.0)
- [v1.74.0](https://api.ynab.com/#v1.74.0)
- [v1.73.0](https://api.ynab.com/#v1.73.0)
- [v1.72.0](https://api.ynab.com/#v1.72.0)
- [v1.71.0](https://api.ynab.com/#v1.71.0)
- [v1.70.0](https://api.ynab.com/#v1.70.0)
- [v1.69.0](https://api.ynab.com/#v1.69.0)
- [v1.68.1](https://api.ynab.com/#v1.68.1)
- [v1.68.0](https://api.ynab.com/#v1.68.0)
- [v1.1.0 - v1.67.0](https://api.ynab.com/#v1.1.0-v1.67.0)
- [v1.0.0](https://api.ynab.com/#v1.0.0)

### Hello Developers

Welcome to the YNAB API!

_(If you aren't a developer or you have no idea what an "API" is and you just want to sign in to your YNAB account, [you can do that here](https://app.ynab.com/).)_

The YNAB API is REST based, uses the JSON data format and is secured with HTTPS. You can use it to build a personal application to interact with your own plan or build an application that any other YNABer can authorize and use.
Be sure to check out what other YNABers have built in the [Works with YNAB](https://api.ynab.com/#works-with-ynab) section.

You can check our [changelog](https://api.ynab.com/#changelog) to find out about updates and improvements to the API.

For support, email **api@ynab.com**. Because our team is small, we may need up to a week to respond. Support for the API is limited, and we cannot provide detailed coding assistance.

### Quick Start

If you're the type of person who just wants to get up and running as quickly as possible and then circle back to
fill in the gaps, these steps are for you:


1. [Sign in to the YNAB web app](https://app.ynab.com/settings) and go to the "Account Settings" page and then to the "Developer Settings" page.

2. Under the "Personal Access Tokens" section, click "New Token", enter your password and click "Generate" to get an access token.
3. Open a terminal window and run this:

`curl -H "Authorization: Bearer <ACCESS_TOKEN>" https://api.ynab.com/v1/plans`

You should get a response that looks something like this:

```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "data": {
    "plans": [\
      {\
        "id": "6ee704d9-ee24-4c36-b1a6-cb8ccf6a216c",\
        "name": "My Plan",\
        "last_modified_on": "2017-12-01T12:40:37.867Z",\
        "first_month": "2017-11-01",\
        "last_month": "2017-11-01"\
      }\
    ]
  }
}
```

That's it! You just received a list of your plans in JSON format through the YNAB API. Hooray!

If you want to start working with the API to build something more substantial, you might want to check out our [YNAB API Starter Kit](https://github.com/ynab/ynab-api-starter-kit) which is a simple, but functional web application that uses the API.

## Authentication

### Overview

All API resources require a valid access token for authentication. There are two ways to obtain access tokens: **Personal Access Tokens** and **OAuth Applications**.

### Personal Access Tokens

Personal Access Tokens are access tokens created by an account owner and are intended to be used only by that same account owner.
They should not be shared and are intended for individual usage scenarios. They are a convenient way to obtain an access token without having to use a full OAuth authentication flow. **If you are an individual developer and want to simply access your own account through the API, Personal Access Tokens are the best choice.**

#### Obtaining a Personal Access Token

To obtain a Personal Access Token,
[sign in to your account](https://app.ynab.com/settings), go to "Account Settings", scroll down and navigate to "Developer Settings" section. From the [Developer Settings](https://app.ynab.com/settings/developer) page, click "New Token" under the Personal Access Tokens section, enter your password
and you will be presented with a new Personal Access Token. You will not be able to retrieve the token later so you should store
it in a safe place. This new token will not expire but can be revoked at any time from this same screen.


**You should not share this access token with anyone or ask for anyone else's access token.** It should be
treated with as much care as your main account password.


![Developer Settings](https://api.ynab.com/papi/developer-settings.png)

![Generate Personal Access Token](https://api.ynab.com/papi/generate-personal-access-token.png)

![New Personal Access Token](https://api.ynab.com/papi/new-personal-access-token.png)

### OAuth Applications

OAuth is a secure way for a third-party application to obtain delegated but limited permissions to a user account and is appropriate for use in applications that need to gain limited authorized permissions to accounts they do not own. If you are developing an application that uses the API and want other users to be able to use your application, **OAuth is the only option for obtaining access tokens for other users**.


All OAuth Application integrations must abide by the [API Terms of Service](https://api.ynab.com/#terms) and the [OAuth Application Requirements](https://api.ynab.com/#oauth-requirements). Failure to do so will result in disabling of the application.


#### Restricted Mode

When an OAuth application is created, it will be placed in _Restricted Mode_ initially. This means the application will be **limited to obtaining 25 access tokens** for users other than the OAuth application owner. Once this limit is reached, a message will be placed on the Authorization screen and new authorizations will be prohibited.

To have Restricted Mode removed, you must [request a review via this form](https://form.asana.com/?k=waDWze4QA7flvIE_tCc27w&d=63941951019692). Your OAuth application will need to abide by the [API Terms of Service](https://api.ynab.com/#terms) and the [OAuth Application Requirements](https://api.ynab.com/#oauth-requirements). Once we review the application and confirm adherence to our policies, we will remove Restricted Mode and send you an email confirmation. This process takes 2-4 weeks.

#### Creating an OAuth Application

To create an OAuth Application, [sign in to your account](https://app.ynab.com/settings), go to "Account Settings", scroll down and navigate to "Developer Settings" section. From the Developer Settings page, click "New Application" under the OAuth Applications section. Here, you specify the details of your application and save it. ![New OAuth Application](https://api.ynab.com/papi/new-oauth-app.png)
After saving, you will see the details of the new application, including the Client ID and the Client Secret which are referenced in the instructions below. ![View OAuth Application](https://api.ynab.com/papi/view-oauth-app.png)

After creating the application, you are then able to use one of the supported _grant types_ to obtain a valid access token. The YNAB API supports two OAuth grant types: **Implicit Grant** and **Authorization Code Grant**.

#### Implicit Grant Flow

The Implicit Grant type, also informally known as the "client-side flow", should be used in scenarios **where the application Secret cannot be kept private**. The application Secret should never be visible or accessible by a client! If you are requesting an access token directly from a browser or other client that is not secure (i.e. mobile app) this is the flow you should use. This grant type does not support refresh tokens so once the access token **expires 2 hours** after it was granted, the user must be prompted again to authorize your application.

The [YNAB API Starter Kit](https://github.com/ynab/ynab-api-starter-kit) implements the Implicit Grant Flow and can be a good starting point for your own project or used as a reference for implementing OAuth.

Here is the flow to obtain an access token:

1. Perform an **Authorization Request**. Send user to the authorization URL: `https://app.ynab.com/oauth/authorize?client_id=[CLIENT_ID]&redirect_uri=[REDIRECT_URI]&response_type=token`, replacing \[CLIENT\_ID\] and \[REDIRECT\_URI\] with the values configured when creating the OAuth Application. The user will be given the option to approve your request for access: ![Authorizing an OAuth Application](https://api.ynab.com/papi/authorize-app.png)
2. Upon user approval, the server will send an **Authorization Response** and the user's browser will be redirected to the \[REDIRECT\_URI\] with a new access token sent as a fragment (hash) identifier named **access\_token**. For example, if your Redirect URI is configured as https://quantumspending.com, upon the user
    authorizing your application, they would be redirected to `https://quantumspending.com/#access_token=8bc63e42-1105-11e8-b642-0ed5f89f718b`. This access token can then be used to authenticate through the API.


#### Authorization Code Grant Flow

The Authorization Code Grant type, also informally known as the "server-side flow", is intended for server-side applications, **where the application Secret can be protected**. If you are requesting an access token from a server application that is private and under your control, this grant type can be used. This grant type supports refresh tokens so once the access token **expires 2 hours** after it was granted, the application can request a new access token without having to prompt the user to authorize again.

##### Obtaining an Access Token

Here is the flow to obtain an access token:

1. Perform an **Authorization Request**. Send user to the authorization URL: `https://app.ynab.com/oauth/authorize?client_id=[CLIENT_ID]&redirect_uri=[REDIRECT_URI]&response_type=code`, replacing \[CLIENT\_ID\] and \[REDIRECT\_URI\] with the values configured when creating the OAuth Application. The user will be given the option to approve your request for access:
    ![Authorizing an OAuth Application](https://api.ynab.com/papi/authorize-app.png)
    There are additional security parameters that can be included in the authorization request to enhance security. These include `scope`, `state`, and `code_challenge` (PKCE). Refer to [Authorization Request Security Parameters](https://api.ynab.com/#oauth-authorization-parameters) for more info.

2. Upon user approval, the server will send an **Authorization Response** and the user's browser will be redirected to the \[REDIRECT\_URI\] with a new authorization code sent as a query parameter named **code**. For example, if your Redirect URI is configured as https://quantumspending.com, upon the user
    authorizing your application, they would be redirected to `https://quantumspending.com/?code=8bc63e42-1105-11e8-b642-0ed5f89f718b`.

3. Perform a **Token Request**. Now that your application has an authorization code, you need to request an access token by sending a **POST** request to `https://app.ynab.com/oauth/token` with the following parameters in the request body:


   - **client\_id** \- The same \[CLIENT\_ID\] sent with the original authorization code in Step 1 above and provided when setting up the OAuth Application.
   - **client\_secret** \- The client secret provided when setting up the OAuth Application.
   - **redirect\_uri** \- The same \[REDIRECT\_URI\] sent with the original authorization code request in Step 1 above and specified when setting up the OAuth Application.
   - **grant\_type** \- The value `authorization_code` should be provided for this field, which will indicate that you are supplying an authorization code and requesting an access token.
   - **code** \- The authorization code received as **code** query param in Step 2 above.

Example token request:

```
curl -X POST https://app.ynab.com/oauth/token \
  -d client_id=[CLIENT_ID] \
  -d client_secret=[CLIENT_SECRET] \
  -d redirect_uri=[REDIRECT_URI] \
  -d grant_type=authorization_code \
  -d code=[AUTHORIZATION_CODE]
```

4. If the Token Request is valid, the server will send a **Token Response**. The body will contain these fields:


```
{
     "access_token": "0cd3d1c4-1107-11e8-b642-0ed5f89f718b",
     "token_type": "bearer",
     "expires_in": 7200,
     "refresh_token": "13ae9632-1107-11e8-b642-0ed5f89f718b"
}
```


    The **access\_token** can be used to authenticate through the API.


##### Using a Refresh Token

The access token has an expiration indicated by the "expires\_in" value. To obtain a new access token without requiring the user to manually authorize again, you should store the **refresh\_token** and then send a **POST** request to `https://app.ynab.com/oauth/token` with the following parameters in the request body:

- **client\_id** \- The same \[CLIENT\_ID\] sent with the original authorization code in Step 1 above and provided when setting up the OAuth Application.
- **client\_secret** \- The client secret provided when setting up the OAuth Application.
- **grant\_type** \- The value `refresh_token` should be provided for this field, which will indicate that you are supplying a refresh token and requesting a new access token.
- **refresh\_token** \- The refresh token received as **refresh\_token** in the token response.

Example refresh token request:

```
curl -X POST https://app.ynab.com/oauth/token \
  -d client_id=[CLIENT_ID] \
  -d client_secret=[CLIENT_SECRET] \
  -d grant_type=refresh_token \
  -d refresh_token=[REFRESH_TOKEN]
```

The response will be in the same format as an initial token response.

#### Authorization Request Security Parameters

##### read-only Scope

When an OAuth application is requesting authorization, a `scope` parameter with a value of `read-only` can be passed to request read-only access to a plan.
For example: `https://app.ynab.com/oauth/authorize?client_id=[CLIENT_ID]&redirect_uri=[REDIRECT_URI]&response_type=token&scope=read-only`. If an access token issued with the `read-only` scope is used when requesting an endpoint that modifies the plan (POST, PATCH, etc.) a `403 Forbidden` response will be issued.
**If you do not need write access to a plan, please use the read-only scope.**

##### state parameter

An optional, but recommended, `state` parameter can also be supplied to prevent [Cross Site Request Forgery (CSRF)](https://owasp.org/www-community/attacks/csrf) attacks. If specified, the same value will be returned to the \[REDIRECT\_URI\] as a `state` parameter. For example:
if you included parameter `state=4cac8f43` in the authorization URI, when the user is redirected to \[REDIRECT\_URI\], the URL would contain that same value in a `state` parameter. The value of `state` should be unique for each request.

##### Proof Key for Code Exchange (PKCE)

PKCE ( [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)) protects the authorization code from interception by ensuring that the client exchanging the code is the same client that initiated the authorization request. To use PKCE, generate a random `code_verifier` string (43-128 characters) and derive a `code_challenge` from it using SHA-256.

Example code verifier and code challenge generation:

```
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '/+' '_-')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d '=' | tr '/+' '_-')
echo "code_verifier: $CODE_VERIFIER"
echo "code_challenge: $CODE_CHALLENGE"
```

Include the `code_challenge` and `code_challenge_method=S256` parameters in the authorization request. For example:
`https://app.ynab.com/oauth/authorize?client_id=[CLIENT_ID]&redirect_uri=[REDIRECT_URI]&response_type=code&code_challenge=[CODE_CHALLENGE]&code_challenge_method=S256`

When exchanging the authorization code for an access token, include the original `code_verifier` in the token request:

```
curl -X POST https://app.ynab.com/oauth/token \
  -d client_id=[CLIENT_ID] \
  -d client_secret=[CLIENT_SECRET] \
  -d grant_type=authorization_code \
  -d code=[AUTHORIZATION_CODE] \
  -d redirect_uri=[REDIRECT_URI] \
  -d code_verifier=[CODE_VERIFIER]
```

#### Default Plan Selection

An OAuth application can optionally have 'default plan selection' enabled.

![OAuth Default Plan Setting](https://api.ynab.com/papi/oauth-default-plan-setting.png)

When default plan selection is enabled, a user will be asked to select a default plan when authorizing your application:

![OAuth Default Plan Selection](https://api.ynab.com/papi/oauth-default-plan-selection.png)

You can then pass in the value 'default' in lieu of a `plan_id` in endpoint calls. For example, to get a list of accounts on the default plan you could use this endpoint: `https://api.ynab.com/v1/plans/default/accounts`.

### Access Token Usage

Once you have obtained an access token, you must use HTTP Bearer Authentication, as defined in [RFC6750](https://tools.ietf.org/html/rfc6750), to authenticate when sending requests to the API. The token should be sent in the `Authorization` request header.

Example:

```
curl -H "Authorization: Bearer <ACCESS_TOKEN>" https://api.ynab.com/v1/plans
```

## Usage

### Overview

Our API uses a
[REST](https://aws.amazon.com/what-is/restful-api/) based design, leverages the
[JSON](https://www.json.org/json-en.html) data format, and relies upon HTTPS for transport. We respond with meaningful HTTP response codes and if an
[error](https://api.ynab.com/#errors) occurs, we include error details in the response body. We support [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS?utm_source=chatgpt.com) which allows you to use the API directly from a web application.


#### Mostly read-only

The current version of the API ("v1") is _mostly_ read-only, supporting `GET` requests. However, we do support some `POST`, `PATCH`, and `DELETE` requests on several resources. Take a look at the [API Endpoints](https://api.ynab.com/v1) for details.

#### Security

TLS (a.k.a. SSL or HTTPS) is enforced on all requests to ensure communication from your client to our endpoint is encrypted,
end-to-end. You must [obtain an access token](https://api.ynab.com/#authentication) and provide it with each request. An access token is tied directly to a YNAB account but can be independently revoked.


### Best Practices

#### Caching

Please cache data received from the API when possible to avoid unnecessary traffic.


#### Delta Requests

Some endpoints support [Delta Requests](https://api.ynab.com/#deltas), where you can request to receive only what has changed since the last response.
It is highly recommended to use this feature as it reduces load on our servers as well as makes processing responses more efficient.


#### Fault Tolerance

Errors and exceptions will sometimes happen. You might experience a connection problem between your app and the
YNAB API or a complete outage. You should always anticipate that errors or exceptions may occur and build in
accommodations for them in your application.


#### Specific Requests

You should use the most specific request possible to avoid large responses which are taxing on the API server and
slower for your app to consume and process. For example, if you want to retrieve the balance for a particular
category, you should request that single category from `/plans/{plan_id}/categories/{category_id}` rather than requesting all categories.


### Endpoints

The base URL is:
`https://api.ynab.com/v1`. To see a list of all available endpoints, please refer to our [API Endpoints](https://api.ynab.com/v1) page. The documentation also lets you "Test Request" on each endpoint directly within the page.


**Note:** The YNAB API was previously available at `https://api.youneedabudget.com/v1`. [In 2023](https://support.ynab.com/en_us/ynab-s-domain-change-SJgdQjeW3) it moved to `https://api.ynab.com/v1`. While existing applications using `https://api.youneedabudget.com/v1` will continue to function, all API consumers should be updated to use `https://api.ynab.com/v1`.


### Response Format

All responses from the API will come with a response wrapper object to make them predictable and easier to parse.

#### Successful Responses

Successful responses will return wrapper object with a `data` property that will contain the resource data.
The name of the object inside of the data property will correspond to the requested resource.


For example, if you request `/plans`, the response will look like:

```
{
  "data": {
    "plans": [\
      {"id": "cee64af3-a3df-425e-a18a-980e7ec10dc2", ...},\
      {"id": "55697d98-b942-4f29-97d8-f870edd001d6", ...}\
    ]
  }
}
```

If you request a single account from `/accounts/{account_id}`:

```
{
  "data": {
    "account": {"id": "16da87a0-66c7-442f-8216-a3daf9cb82a8", ...}
  }
}
```

##### Empty data

Response data properties that have no data will be specified as `null` rather than being omitted. For example, a transaction that does not have a payee would have a body that looks like this:

```
{
  "data": {
    "transaction": {
      "id": "16da87a0-66c7-442f-8216-a3daf9cb82a8",
      "date": "2017-12-01",
      "payee_id": null,  // This transaction does not have a payee
      ...
    }
  }
}
```

#### Error Responses

For error responses, the HTTP Status Code will be specified as something other than `20X` and the body of the response will contain an error object.
The format of an error response is:


```
{
  "error": {
    "id": "123"
    "name": "error_name"
    "detail": "Error detail"
  }
}
```

The [Errors](https://api.ynab.com/#errors) section lists the possible errors.

### Errors

Errors from the API are indicated by the HTTP response status code and also included in the body of the response,
according to the
[response format](https://api.ynab.com/#response-format). The following errors are possible:


| HTTP Status | Error ID | Name | Description |
| --- | --- | --- | --- |
| 400 | 400 | bad\_request | The request could not be understood by the API due to malformed syntax or validation errors. |
| 401 | 401 | not\_authorized | This error will be returned in any of the following cases:<br> <br>- Missing access token<br>- Invalid access token<br>- Revoked access token<br>- Expired access token |
| 403 | 403.1 | subscription\_lapsed | The subscription for this account has lapsed |
|  | 403.2 | trial\_expired | The trial for this account has expired |
|  | 403.3 | unauthorized\_scope | The supplied access token has a scope which does not allow access. |
|  | 403.4 | data\_limit\_reached | The request will exceed one or more data limits in place to prevent abuse. |
| 404 | 404.1 | not\_found | The specified URI does not exist |
|  | 404.2 | resource\_not\_found | This error will be returned when requesting a resource that is not found. For example, if you requested **/plans/123** and a plan with the id '123' does not exist, this error would be returned. |
| 409 | 409 | conflict | If resource cannot be saved during a PUT or POST request because it conflicts with an existing resource, this error will be returned. |
| 429 | 429 | too\_many\_requests | This error is returned if you make too many requests to the API in a short amount of time. Please see the [Rate Limiting](https://api.ynab.com/#rate-limiting) section. Wait awhile and try again. |
| 500 | 500 | internal\_server\_error | This error will be returned if the API experiences an unexpected error. |
| 503 | 503 | service\_unavailable | This error will be returned in any of the following cases:<br> <br>- We have temporarily disabled access to the API. This can happen when we are experiencing heavy load or need to perform maintenance.<br>- A request timeout has occurred. This can happen if the API request is processing a large amount of data and takes longer than 30 seconds to complete. |

### Data Formats

#### Numbers

Currency amounts returned from the API—such as account balance, category balance, and transaction amounts—
use a format we call "milliunits". Most currencies don't have three decimal places, but you can think of it as the number of thousandths of a unit in the currency: 1,000
milliunits equals "one" unit of a currency (one Dollar, one Euro, one Pound, etc.). Here are some concrete examples:


| Currency | Milliunits | Amount |
| --- | --- | --- |
| USD ($) | 123930 | $123.93 |
| USD ($) | -220 | -$0.22 |
| Euro (€) | 4924340 | €4.924,34 |
| Euro (€) | -2990 | -€2,99 |
| Jordanian dinar | -395032 | -395.032 |

#### Dates

All dates returned in response calls use [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) ( [RFC 3339 "full-date"](https://tools.ietf.org/html/rfc3339#section-5.6)) format. For example,
December 30, 2015 is formatted as `2015-12-30`.


#### Timezone

All dates use UTC as the timezone.

### Delta Requests

The following API resources support "delta requests", where you ask
for only those entities that have changed since your last request:


- `GET /plans/{plan_id}`
- `GET /plans/{plan_id}/accounts`
- `GET /plans/{plan_id}/categories`
- `GET /plans/{plan_id}/money_movements`
- `GET /plans/{plan_id}/money_movement_groups`
- `GET /plans/{plan_id}/months`
- `GET /plans/{plan_id}/payees`
- `GET /plans/{plan_id}/scheduled_transactions`
- `GET /plans/{plan_id}/transactions`

We recommend using delta requests as they allow API consumers to
parse less data and make updates more efficient, and decreases
server load on our end.


Resources supporting delta requests return a
**server\_knowledge** number in the
[response](https://api.ynab.com/#response-format). This number can then be
passed in as the **last\_knowledge\_of\_server** query
parameter. Then, only the data that has changed since the last
request will be included in the response.


For example, if you request a plan's contents from
`/plans/{plan_id}`, it will include the
**server\_knowledge** like so:


```
{
  "data": {
    "server_knowledge": 100,
    "plan": {
      "id": "16da87a0-66c7-442f-8216-a3daf9cb82a8",
      ...
    }
  }
}
```

On a subsequent request, you can pass that same
**server\_knowledge** in as a query parameter named
**last\_knowledge\_of\_server**
(`/plans/{plan_id}?last_knowledge_of_server=100`)
and get back _only the entities that have changed_ since your
last request. For example, if a single account had its name changed
since your last request, the response would look something like:


```
{
  "data": {
    "server_knowledge":101,
    "plan":{
      ...
      "accounts": [\
        {\
          "id":"ea0c0ace-1a8c-4692-9e1d-0a21fe67f10a",\
          "name":"Renamed Checking Account",\
          "type":"Checking",\
          "on_budget":true,\
          "closed":false,\
          "note":null,\
          "balance":20000\
        }\
      ],
      ...
    }
  }
}
```

### Rate Limiting

An access token may be used for up to **200 requests per hour**.

The limit is enforced within a rolling window. If an access token is used at 12:30 PM and for 199 more requests up to 12:45 PM and then hits the limit, any additional requests will be forbidden until enough time has passed for earlier requests to fall outside of the preceding one-hour window.

If you exceed the rate limit, an error response returns a **429** error:

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json; charset=utf-8

"error": {
  "id": "429"
  "name": "too_many_requests"
  "detail": "Too many requests"
}
```

## Libraries

### JavaScript

The JavaScript library is available via
[npm](https://www.npmjs.com/package/ynab) and the source and documentation is located on
[GitHub](https://github.com/ynab/ynab-sdk-js). This library can be used server-side (Node.js) or client-side (web browser) since we support [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS).


If you are using the JavaScript library, you might want to also take a look at the [YNAB API Starter Kit](https://github.com/ynab/ynab-api-starter-kit) which is a simple, but functional web application that uses the JavaScript library.


#### Installation

```
npm install ynab
```

#### Usage

```
const ynab = require("ynab");
const accessToken = "123-yourAccessTokenHere-456";
const ynabAPI = new ynab.API(accessToken);

(async function() {
  const plansResponse = await ynabAPI.plans.getPlans();
  const plans = plansResponse.data.plans;
  for(let plan of plans) {
    console.log(`Plan Name: ${plan.name}`);
  }
})();
```

### Ruby

The Ruby library is available via
[RubyGems](https://rubygems.org/gems/ynab) and the source and documentation is located on
[GitHub](https://github.com/ynab/ynab-sdk-ruby).


#### Installation

```
gem install ynab
```

If using Bundler, add `gem 'ynab'` to your Gemfile and then run `bundle`.

#### Usage

```
require 'ynab'
access_token = '123-yourAccessTokenHere-456'
ynab_api = YNAB::API.new(access_token)

plans_response = ynab_api.plan.get_plans
plans = plans_response.data.plans

plans.each do |plan|
  puts "Plan Name: #{plan.name}"
end
```

### Python

The Python library is available via
[PyPi](https://pypi.org/project/ynab/) and the source and documentation is located on
[GitHub](https://github.com/ynab/ynab-sdk-python).


#### Installation

```
pip install ynab
```

#### Usage

```
import ynab

configuration = ynab.Configuration(
    access_token = "123-yourAccessTokenHere-456"
)

with ynab.ApiClient(configuration) as api_client:
    plans_api = ynab.PlansApi(api_client)
    plans_response = plans_api.get_plans()
    plans = plans_response.data.plans

    for plan in plans:
        print(plan.name)
```

### Community

The following libraries have been created and are maintained by YNABers. We do not provide support for these clients but appreciate the effort!

- .NET - [YNAB.API.Client](https://github.com/tombly/ynab-api-client) by Tom Bulatewicz
- Elixir - [ynab-elixir](https://github.com/teedang19/ynab-elixir) by Tam Dang
- Go - [ynab.go](https://github.com/brunomvsouza/ynab.go) by Bruno Souza
- Java - [Java SDK for YNAB API](https://github.com/daviddietz/ynab-sdk) by David Dietz
- Julia - [ynab-tools](https://github.com/tonyrubak/ynab-tools) by Joseph Peralta
- Kotlin - [ynab-kmp-api](https://github.com/libec/ynab-kmp-api) (Kotlin Multiplatform) by Libor Huspenina
- Perl - [WWW::YNAB](https://metacpan.org/pod/WWW::YNAB) by Jesse Luehrs
- PHP - [ynab-sdk-php](https://github.com/JPry/ynab-sdk-php) by Jeremy Pry
- PowerShell - [Posh-YNAB](https://github.com/ConnorGriffin/Posh-YNAB) by Connor Griffin
- R - [rnab](https://github.com/ejkreboot/rnab) by Eric Kort
- Rust - [ynab-rs](https://github.com/Phrohdoh/ynab-rs) by Taryn Phrohdoh
- Swift - [swiftynab](https://github.com/andrebocchini/swiftynab) by Andre Bocchini

These libraries are not affiliated, associated, or officially connected with YNAB or any of its subsidiaries of affiliates. Please review their respective privacy policies, as they may differ from ours. YNAB is not responsible and cannot be held liable for any potential data breaches that may occur from their use. By adding any of these tools, you assume any associated risks.


## Works with YNAB

![Works With YNAB](https://api.ynab.com/papi/works_with_ynab.svg)

### Official

The following applications are official YNAB integrations that we developed and support.

- [API Starter Kit](https://github.com/ynab/ynab-api-starter-kit) \- Quickly get started developing an application with the YNAB API
- [Zapier for YNAB](https://zapier.com/apps/ynab/integrations) \- Zapier allows you to instantly connect YNAB with 1,500+ apps to automate your work and find productivity super powers.

### Third Party

The following third party applications have been developed by the YNAB community. We do not provide support for these applications. If you have built an OAuth application you'd like shared here, see [OAuth Applications](https://api.ynab.com/#oauth-applications).

- [Additional Budget Graphs](https://additionalbudgetgraphs.web.app/) \- Some additional graphing and other abilities for YNAB
- [AutoSlip](https://autoslip.ai/) \- Receipt parsing for YNAB: auto-split and categorize purchases from grocery, Amazon, Target, and anywhere else you shop.
- [Beeminder](https://www.beeminder.com/) \- Beeminder is a tool that helps you meet your goals, by putting your money where your mouth is.
- [Beyond Rule 4](https://beyondrule4.jmmorrissey.com/) \- Your Age of Money is ever rising. You're feeling in control of your money. Congratulations!
What would you like to accomplish next?
- [Bills (for YNAB)](https://danielhaven.com/billsforynab) \- A web app for tracking bills (recurring expenses) with YNAB.
- [bridgeyourbudget](https://bridgeyourbudget.com/) \- Automatically sync your Amazon purchases with YNAB transactions
- [Budget Feeder](https://www.budgetfeeder.com/) \- Sync your Australian bank transactions to YNAB!

148 Australian Banks and credit cards supported including Amex, ANZ, Westpac, NAB and CBA.

No need to enter transactions manually, with automatic bank feeds your transactions sync seamlessly to your YNAB budget accounts every day. Let Budget Feeder do the hard work for you.
- [Calendar for YNAB](https://calendarforynab.com/) \- Subscribe to a calendar of your transactions.
- [Check Out My Budget: Browser Extension](https://checkoutmybudget.com/) \- Take your budget with you to places you shop online. Displaying your budget there when you are ready to make a purchase will help you stick to your budget and avoid impulse buys. Customize the categories that are displayed from your budget on each website so you can see the relevant ones easily for the website that you are visiting.
- [Check Out My Budget: Transaction Copier for YNAB](https://checkoutmybudget.com/tools/copy_transactions/) \- Have you ever wanted to play around with your YNAB categories, re-categorizing some of your transactions just to see how it would work? YNAB’s Fresh Start only copies over the categories and accounts, but doesn’t bring the transactions over so it is hard to do this without risking messing up your existing budget.

This tool copies the transactions from one budget to a new budget, containing all the transactions into a single "migration" account. When you run this tool, the new budget must be a "Fresh Start" of the old one with all the same groups and categories but once the tool has run and the transactions are are copied over, you can re-categorize and experiment to your hearts content!
- [Coda Sync for YNAB](https://coda.io/@david-weitzman/coda-for-ynab) \- A Coda pack to sync your transactions into a doc
- [Cost Sharing for YNAB](https://costsharingforynab.com/) \- Conveniently manage a shared credit card or bank account in YNAB
- [Custom Reports for YNAB](https://www.customreportsforynab.com/) \- Explore your transactions further with custom reports beyond YNAB's built-in reports.
- [DAKboard](https://dakboard.com/) \- DAKboard is a customizable display for photos, calendar, news, weather and so much more!
- [Dash for YNAB](https://dashforynab.com/) \- Dashboard and reporting tools for YNAB.
- [DayDash](https://daydash.io/) \- DayDash syncs your Ynab data so you can view and analyze your accounts and transactions.
- [Email Integration for YNAB](https://www.email4ynab.com/) \- Add transactions to YNAB by forwarding your bank emails. Permission to Read is needed to match Accounts, Categories, and Payees.
- [FBAR Max Balance Calculator](https://fbar-max-balance-calculator.vercel.app/) \- An app that allows you to calculate your max account balances for the Report of Foreign Bank and Financial Accounts (FBAR).
- [FinInsights for YNAB](https://fininsights.io/) \- AI-powered financial intelligence for YNAB budgets. FinInsights provides
read-only budget analysis, spending pattern detection, and intelligent
reallocation recommendations to help users optimize their YNAB budgets.
- [GPT for YNAB (Unofficial)](https://chat.openai.com/g/g-88YNmz2RR-gpt-for-ynab) \- AI assistant for You Need A Budget (YNAB), powered by ChatGPT. Not affiliated with or endorsed by YNAB. As with any AI, this assistant can hallucinate or be flat out wrong. DO NOT make financial decisions based on this assistant.
- [Heatmap for YNAB](https://heatmapforynab.netlify.app/) \- A report that displays your YNAB transactions in a heatmap style to get a bird's eye view of your budget.
- [Importer for YNAB](https://www.importer-for-ynab.app/) \- Importer for YNAB is a free, open-source tool that helps you convert Israeli bank and credit card files to the YNAB format. It supports major banks and credit cards including Isracard, Cal, Max, Mizrahi, and Poalim.
- [LedgerGPT](https://ledgergpt.io/) \- AI-assisted ledger reconciliation for personal finances. Automatically parses statements, compares them to your ledger, and proposes accurate updates for review.
- [Lumy](https://lumyforynab.app/) \- Lumy helps you get more out of your YNAB budget with features like Month in Review, Frugal Month, Spend Trackers, and more! Tune into your budget with configurable reports and charts, and join the active community of Lumy users on our Discord!
- [Lunch Flow](https://www.lunchflow.app/) \- Connect your banks and investments globally to your favorite tools.
- [Manio](https://manio.app/) \- Manio automatically syncs your Brazilian bank transactions to YNAB. Connect your bank through Open Finance and keep your budget up to date.
- [Mobile Toolbox for YNAB](https://budget.friedmag.com/) \- This application connects with a user’s live budget data to generate actionable insights on cash-flow, measure progress toward financial independence, track savings for future liabilities (such as children’s education), and optimise credit-card reward strategies.
- [Mo's Flows](https://mosflows.com/) \- Visualize your Value - A Budget Visualizer
- [Multi-currency for YNAB](https://ynab.rmillan.com/) \- Manage YNAB accounts with multiple currencies in a single budget
- [MYMM Sync for YNAB](https://www.makingyourmoneymatter.com/mymm-sync-for-ynab/) \- Import your YNAB data to your Personal Finance Bundle in Google Sheets with a few clicks!
- [On Target Analysis For YNAB](https://www.ontargetanalysisforynab.com/) \- Allows you to compare how closely the money they assigned matches your targets/goals for the month. Quickly highlights categories you assigned much more than you targeted and much less than you targeted. This quick comparison makes it easy to reflect on if you made the right trade offs
- [Peek for YNAB](https://peekforynab.com/) \- A browser extension to check on your category and account balances in YNAB, and quickly add transactions.
- [Pipedream](https://pipedream.com/) \- Integration platform for developers
- [ProjectionLab Sync](https://chrome.google.com/webstore/detail/ynab-%3E-projectionlab-sync/loeekpinmlccgelapofbejkbnfilfggl) \- Syncs YNAB account balances with ProjectionLab. Allows you to grow beyond Rule 4 with detailed projections and tax models.
- [Receipt Reader AI](https://receiptreader.ai/) \- All-in-one receipt management app
- [Receipts for YNAB](https://eturea.github.io/Receipts-for-YNAB-site/) \- Scan receipts and auto-split line items into YNAB categories.
Uses on-device Apple Intelligence — your receipts never leave your iPhone. iOS app.
- [Snapt](https://usesnapt.com/) \- AI-powered receipt analyzer that automatically splits your purchases into budget categories. Send a receipt photo via Telegram, and SNAPT creates itemized split transactions in your YNAB budget.
- [Splitwise for YNAB](https://splitwiseforynab.com/) \- Sync shared expenses with your partner between YNAB and Splitwise
- [Stats for YNAB](https://apps.apple.com/us/app/stats-for-ynab/id6444380128) \- Discover money insights right in your device.
- [Streaks (For YNAB)](https://danielhaven.com/streaksforynab/) \- Build healthy spending habits using your YNAB transactions.
- [Sync for YNAB](https://syncforynab.com/) \- Connect your bank to YNAB
- [Synci.io](https://synci.io/) \- Automatically import bank transactions to YNAB. Synci is connected to 2447 banks across 31 European countries.
- [Target Visualizer for YNAB](https://bany.justindra.com/) \- Visualize your monthly targets to work out how much money you need to earn and where you've allocated your targets.
- [Undebt.it](https://undebt.it/syncing-with-ynab.php) \- Undebt.it is a free, mobile-friendly debt snowball calculator
- [viaSocket](https://viasocket.com/) \- viaSocket enables secure, no-code automation between YNAB and other 2000+ applications, allowing users to sync data and automate workflows.

## Legal

### API Terms of Service

We provide the YNAB API so that YNAB-loving developers can make really cool projects and applications. We have some expectations and guidelines about how you’ll do that. Officially, these guidelines are our API Terms of Service because, well, that’s what they’re called. They work hand-in-hand with our general [YNAB Terms of Service](https://www.ynab.com/terms/), the [YNAB Privacy Policy](https://www.ynab.com/privacy-policy/), and all apply to your use of the API. By accessing or using our APIs, you are agreeing to these terms. We appreciate you reading them carefully and, naturally, following them.


To keep the text here readable, we refer to the following as the “Terms”:


- the YNAB Terms of Service;
- the YNAB Privacy Policy;
- the API Terms of Service below;
- terms within any API documentation;
- and any other applicable policies.

In order to protect the website, our apps, and our customers and their data, you agree to comply with them and that they govern your relationship with us.


With that said, here are the YNAB API Terms of Service:


01. **Authorized Use.** To use the YNAB API and accept the Terms you must be of a legal age to form a binding contract with YNAB. The YNAB API may only be used when permission is explicitly given by a YNAB account owner through the Authentication processes described in the [documentation](https://api.ynab.com/#authentication) above.
02. **Security and Permitted Access.** Access tokens must be handled securely and never be exposed to a third party. The Terms and API documentation outline the only permissible ways in which you can interact with the YNAB API. You are NEVER ALLOWED to directly request, handle or store credentials associated with users’ financial accounts. Securely storing an access token obtained directly from a financial institution using OAuth is allowed.
03. **API Limitations.** YNAB sets and enforces limits on your use of the APIs at our discretion. Those limits may change and are at our sole discretion. Any attempt to circumvent those limitations is a violation of these terms.
04. **Illegal and Restricted Use.** We developed this API so you can do good, kind, helpful things with it and to make YNAB better. So: The YNAB API may not be used for illegal purposes (and this includes, without limitation, things like pornography, terrorism, you catch the drift). Which seems obvious, but it’s important to say it. Beyond legality, we also restrict the use of the YNAB API in certain ways. You agree not to use, or allow any third party to use, the YNAB API to engage in or promote any activity that is objectionable, violates the rights of others, is likely to cause notoriety, harm or damage to the reputation of YNAB or could subject YNAB to liability to third parties. This might include: (i) unauthorized access, monitoring, interference with, or use of the YNAB API or third-party accounts, data, computers, systems or networks; (ii) interference with others’ use of the YNAB API or any system or network; (iii) unauthorized collection or use of personal or confidential information; (iv) any other activity that places YNAB in the position of having potential or actual liability for activity in any jurisdiction.
05. **Attribution & Intellectual Property.**    1. You and your integration or app may not identify or refer to YNAB in any manner that creates a false suggestion (either directly or indirectly!) that an application is sponsored, endorsed, or supported by YNAB. This includes an application name, description, graphics and artwork, and/or web address (DNS name).

    2. Somewhere on your site page, please add the following language at the footer:


       > We are not affiliated, associated, or in any way officially connected with YNAB or any of its subsidiaries or affiliates. The official YNAB website can be found at [https://www.ynab.com](https://www.ynab.com/).
       >
       >
       >  The names YNAB and You Need A Budget, as well as related names, tradenames, marks, trademarks, emblems, and images are registered trademarks of YNAB.

    3. To identify that your app integrates with YNAB, you may use [this linked image](https://api.ynab.com/papi/works_with_ynab.svg) and refer to “for YNAB” in the name of your application. Any other uses of our content are subject to the [Intellectual Property Rights](https://www.ynab.com/terms/#h-intellectual-property-rights) and [Trademarks](https://www.ynab.com/terms/#h-trademarks) sections of the [YNAB Terms of Service](https://www.ynab.com/terms/). Don’t use ‘em.
06. **Functionality and Non-exclusivity.** You may not use the YNAB API to copy or duplicate products or services offered by YNAB. Also, you acknowledge that YNAB may, now or in the future, offer products, services, or features that are similar to your application.
07. **Compliance and Monitoring.** YNAB may, but has no obligation to, monitor use of the YNAB API to verify your compliance with the Terms or any other applicable law or legal requirement.
08. **Accept Updates.** The YNAB API may periodically be updated with tools, utilities, improvements, or general updates. You agree to receive these updates.
09. **Termination.** YNAB may terminate or suspend any and all access to the API immediately at any time, without prior notice or liability at our sole discretion.
10. **Children.** Your application may not be directed or for children under 13. The minimum age for a user to use YNAB is 13.
11. **Indemnification.** You shall defend, hold harmless, and indemnify, YNAB, its contractors, employees, agents, and the like from and against any and all third-party claims, actions, suits, proceedings, and demands, including all damages, liabilities, costs, expenses, and reasonable attorney’s fees, arising out of your use of the API and/or violation of these Terms.
12. **Limitation of Liability.** YNAB shall not be liable under this Agreement under any contract, negligence, strict liability, or other legal or equitable theory, whether in contract or in tort, for (1) lost profits or revenues, (2) any indirect, special, incidental, or consequential damages, (3) the cost of procurement of substitute products or services, or (4) interruption of use or loss or corruption of data.
13. **Warranties.** YNAB’s API is provided on an “as is” and “as available” basis. YNAB disclaims all warranties of any kind, express or implied, including, without limitation, the warranties of merchantability, title, fitness for a particular purpose, and noninfringement. YNAB makes no warranty that the API will be error free, timely, or secure, or that access will be continuous or uninterrupted.
14. **Changes.** YNAB reserves the right to revise, update, and/or modify these terms from time to time in YNAB’s sole discretion by posting them on this page and/or notifying. Your continued use of the API following the posting of the revised terms means that you accept and agree to these changes. It is important that you review the Terms whenever we modify them because your continued use of the YNAB API indicates your agreement to the modifications.

### OAuth Application Requirements and User Data Policy

In addition to the above terms, OAuth Applications must adhere to these requirements:


1. You must publish a privacy policy that is displayed to users.
1. There are sites like Terms Feed that can assist with drafting a privacy policy. We do not represent, warrant, or guarantee that the language provided by the Terms Feed privacy policy generator will ensure compliance with data privacy laws. You may consult a lawyer at your own expense if you need guidance.
2. YNAB is not responsible for reviewing your Privacy Policy and determining whether it is compliant with all applicable privacy laws. YNAB is also not responsible for any other policies on your site.
3. Your privacy policy must include, but is not limited to, the following:
      1. You must be honest and transparent with users about the purpose for which you use their data. If you collect data for two purposes, you must disclose what those two purposes are. Your use of YNAB user data must be limited to the practices disclosed in your privacy policy.
      2. A clear explanation of how the data obtained through the YNAB API will be handled, stored, secured, and how long it will be kept, which must be accurate and comprehensive. It must thoroughly disclose how your application accesses, users, stores, or shares YNAB user data.
      3. A guarantee that the data obtained through the YNAB API will not unknowingly be passed to any third party.
      4. A method for users to delete their data if they request it (can be a contact email). You must delete user data if they request.
      5. A "Last Updated" date
2. If you access or use a type of data not originally disclosed in your privacy policy when a YNAB user initially authorized access or if you change the way your application uses YNABer data, you must update your privacy policy and prompt the user to consent to any changes before you may access the data.
3. Display the privacy policy URL in your OAuth client configuration when your application is publicly available and ensure that it is prominently displayed in your application interface so that users can find this information easily.

4. Only request the minimum necessary permissions to run your application, features, or services and don’t request access to information that you don’t need. Request access in context, via incremental authorization, wherever possible.

5. Do not engage in any activity that may deceive, misrepresent, or lead to unauthorized use of YNAB’s API. Do not (1) misrepresent the data you collect or what you use with user data, (2) access, aggregate, or analyze YNAB user data if the data will be sold to a third party, (3) mislead us about your application’s operating environment, (4) use undocumented APIs without express written permission, and (5) make false or misleading statements about any entities that have authorized or managed your application.

6. The application must not directly request, handle or store any financial account credentials other than an access token obtained directly from a financial institution using OAuth.

7. Maintain a secure operating environment.

8. In line with the _Attribution & Intellectual Property_ section of the [API Terms of Service](https://api.ynab.com/#terms) above:

1. The application and the web address (DNS name) must not include "YNAB" or "You Need A Budget" unless preceded by the word "for".

      _Acceptable_: "Budget Tools", "Transaction Syncer", "Currency Tools for YNAB".

      _Unacceptable_: "YNAB Tools", "YNAB Transaction Syncer", "Advanced YNAB".

2. Any graphics or artwork may not be modifications to our official branding and must be distinguishable from YNAB itself and/or from YNAB’s graphics or artwork.

_Last updated: May 28, 2025_

## Changelog

### v1.79.0

**2026-03-05**

- All API endpoints now use `/plans/{plan_id}` as the primary resource path instead of `/budgets/{budget_id}`. Response JSON keys have been updated accordingly: `budgets` is now `plans`, `default_budget` is now `default_plan`, and `budget` is now `plan`.
- The previous `/budgets/{budget_id}` paths continue to work and will return the original response key names for backward compatibility, but are no longer documented.

### v1.78.0

**2026-02-25**

- Added support for creating [categories](https://api.ynab.com/v1#tag/categories/POST/plans/{plan_id}/categories) and category groups [category groups](https://api.ynab.com/v1#tag/categories/POST/plans/{plan_id}/category_groups).
- Added support for updating [category groups](https://api.ynab.com/v1#tag/categories/PATCH/plans/{plan_id}/category_groups/{category_group_id}).
- A `goal_target` amount and `goal_target_date` can be specified when [creating categories](https://api.ynab.com/v1#tag/categories/POST/plans/{plan_id}/categories) or [updating categories](https://api.ynab.com/v1#tag/categories/PATCH/plans/{plan_id}/categories/{category_id}), even if a goal has not already been configured for the category. A "set aside (monthly)" goal will be configured when `goal_target` is specified and a goal is not already configured. If \`goal\_target\_date\` is also specified the goal will be configured with a "due on" date that repeats monthly.
- Category models now include `goal_target_date` which should be used instead of `goal_target_month` (which is now deprecated). `goal_target_month` will continue to be sent in responses for backwards compatibility but should not be used going forward.
- Added `GET` endpoints for [money movements](https://api.ynab.com/v1#tag/money-movements/GET/plans/{plan_id}/money_movements) and [money movement groups](https://api.ynab.com/v1#tag/money-movements/GET/plans/{plan_id}/money_movement_groups). These new endpoints support [Delta Requests](https://api.ynab.com/#deltas).
- All `budget_id` parameter names have been changed to `plan_id`.

### v1.77.0

**2025-08-11**

- Deprecated `debt_original_balance` field on account data responses. This field was never fully implemented, is now deprecated, and will always be specified as `null` in responses.

### v1.76.0

**2025-08-05**

- Expose `goal_snoozed_at` timestamp on category data responses.

### v1.75.0

**2025-06-30**

- `GET budgets/{budget_id}/transactions/{transaction_id}` was incorrectly returning a `transaction_ids` object which was not defined in the spec. This field has been removed.
- `POST /budgets/:{budget_id}/transactions` and `PATCH /budgets/{budget_id}/transactions` were missing `transaction_ids` object defined in the spec. This field has been added to responses.

### v1.74.0

**2025-03-03**

- New `PUT` and `DELETE` ( [update](https://api.ynab.com/v1#tag/scheduled-transactions/PUT/plans/{plan_id}/scheduled_transactions/{scheduled_transaction_id}) and [delete](https://api.ynab.com/v1#tag/scheduled-transactions/DELETE/plans/{plan_id}/scheduled_transactions/{scheduled_transaction_id})) endpoints for scheduled\_transactions.
- `payee_name` and `category_name` fields have been added to `subtransactions` objects in [scheduled transaction](https://api.ynab.com/v1#tag/scheduled-transactions/GET/plans/{plan_id}/scheduled_transactions) responses.
- The `goal_target` amount for a category can now be [updated](https://api.ynab.com/v1#tag/categories/PATCH/plans/{plan_id}/categories/{category_id}).

### v1.73.0

**2025-01-29**

When a `429 Too Many Requests` response is returned because the [Rate Limit](https://api.ynab.com/#rate-limiting) has been exceeded, a `X-Rate-Limit` response header is no longer included.

### v1.72.0

**2024-07-10**

Add ability to fetch [transactions for a specific month](https://api.ynab.com/v1#tag/transactions/GET/plans/{plan_id}/months/{month}/transactions).

### v1.71.0

**2024-06-03**

Add support for creating [scheduled transactions](https://api.ynab.com/v1#tag/scheduled-transactions/POST/plans/{plan_id}/scheduled_transactions).

### v1.70.0

**2024-06-12**

Add `goal_needs_whole_amount` to all [category](https://api.ynab.com/v1#tag/categories/GET/plans/{plan_id}/categories) responses. This field indicates the monthly rollover behavior for `NEED`-type goals. When "true", the goal will always ask for the target amount in the new month ("Set Aside"). When "false", previous month category funding is used ("Refill"). For other goal types, this field will be null.

### v1.69.0

**2024-05-14**

Add ability to update a [payee's name](https://api.ynab.com/v1#tag/payees/PATCH/plans/{plan_id}/payees/{payee_id})

### v1.68.1

**2024-04-24**

Remove `server_knowledge` field from _single_ category resource responses (`GET budgets/{budget_id}/months/{month}/categories/{category_id}` and `GET budgets/{budget_id}/categories/{category_id}`). These endpoints do not support [delta requests](https://api.ynab.com/#deltas) and the `server_knowledge` field has been mistakenly included in their responses.

### v1.68.0

**2024-02-26**

- Add `flag_name` to all `transaction` [responses](https://api.ynab.com/v1#tag/transactions/GET/plans/{plan_id}/transactions)
- Add `flag_name` to all `scheduled_transaction` [responses](https://api.ynab.com/v1#tag/scheduled-transactions/GET/plans/{plan_id}/scheduled_transactions)

### v1.1.0 - v1.67.0

**2024-02-20**

Various new features and enhancements.

### v1.0.0

**2018-06-19**

Initial release of the [YNAB API](https://www.ynab.com/blog/introducing-ynabs-api).