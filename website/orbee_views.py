import json
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods
from . import orbee_ai


@never_cache
@require_http_methods(['GET','POST'])
def chat(request):
    if request.method=='GET':
        return JsonResponse({'status':'ready' if orbee_ai.configured() else 'not_configured',
                             'provider':'Anthropic Claude','model':orbee_ai.settings.ORBEE_MODEL,
                             'reply_style':orbee_ai.REPLY_STYLE,
                             'response_policy':orbee_ai.RESPONSE_POLICY,
                             'max_message_chars':orbee_ai.MAX_QUESTION})
    try:
        if request.content_type!='application/json' or len(request.body)>65000:
            raise orbee_ai.OrbeeError('invalid_request')
        payload=json.loads(request.body)
        return JsonResponse(orbee_ai.reply(request,payload))
    except (ValueError,UnicodeError):
        return JsonResponse({'status':'invalid_request'},status=400)
    except orbee_ai.OrbeeError as error:
        code=400 if error.status=='invalid_request' else 429 if error.status in ('rate_limited','busy') else 409 if error.status=='pin_changed' else 503
        retryable=error.status in {'timeout','network_error','unavailable','busy','rate_limited','response_limit','empty_response','invalid_response','pin_changed'}
        # Safe operational metadata only: no prompt, response body, key or headers.
        orbee_ai.logger.warning('Orbee reply failed: status=%s request_id=%s',error.status,error.request_id or 'not-provided')
        return JsonResponse({'status':error.status,'retryable':retryable,'request_id':error.request_id},status=code)
