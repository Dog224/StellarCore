from django.contrib import admin
from django.urls import path
from website.views import entry, home, dashboard_data, weather_data, weather_history, place_context, home_conditions, market_data, market_rates, gaez_catalog, gaez_point, crop_recommendations, crop_gaez, copernicus_data, copernicus_image
from website.auth_views import FarmerLoginView, FarmerLogoutView, signup
from website.views import workspace
from website.orbee_views import chat as orbee_chat

urlpatterns = [path('', entry, name='entry'), path('map/', home, name='home'), path('api/dashboard/', dashboard_data, name='dashboard-data'),
               path('api/weather/', weather_data, name='weather-data'), path('admin/', admin.site.urls)]
urlpatterns += [path('login/', FarmerLoginView.as_view(), name='login'),
                path('signup/', signup, name='signup'), path('logout/', FarmerLogoutView.as_view(), name='logout')]
urlpatterns += [path('api/weather/history/', weather_history, name='weather-history')]
urlpatterns += [path('api/place/', place_context, name='place-context')]
urlpatterns += [path('api/home/conditions/', home_conditions, name='home-conditions')]
urlpatterns += [path('api/market/', market_data, name='market-data'),path('api/market/rates/', market_rates, name='market-rates')]
urlpatterns += [path('workspace/<slug:section>/', workspace, name='workspace')]
urlpatterns += [path('api/orbee/chat/', orbee_chat, name='orbee-chat')]
urlpatterns += [path('api/gaez/catalog/', gaez_catalog, name='gaez-catalog'),
                path('api/gaez/point/', gaez_point, name='gaez-point')]
urlpatterns += [path('api/crops/recommendations/', crop_recommendations, name='crop-recommendations'),
                path('api/crops/gaez/', crop_gaez, name='crop-gaez')]
urlpatterns += [path('api/copernicus/', copernicus_data, name='copernicus-data'),
                path('api/copernicus/image/', copernicus_image, name='copernicus-image')]
