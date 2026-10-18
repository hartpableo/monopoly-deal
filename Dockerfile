FROM php:8.5-apache

# Install MySQL PDO extension
RUN docker-php-ext-install pdo_mysql

# Enable Apache mod_rewrite & headers
RUN a2enmod rewrite headers \
    && echo "ServerName localhost" >> /etc/apache2/apache2.conf

# Allow .htaccess overrides and configure directory permissions
RUN echo '<Directory /var/www/html>\n\
    Options -Indexes +FollowSymLinks\n\
    AllowOverride All\n\
    Require all granted\n\
\n\
    # Restrict direct web access to PHP files: only index.php and api.php are accessible\n\
    <FilesMatch "(?i:\\.php$)">\n\
        Require all denied\n\
    </FilesMatch>\n\
    <FilesMatch "(?i:^(index|api)\\.php$)">\n\
        Require all granted\n\
    </FilesMatch>\n\
</Directory>' > /etc/apache2/conf-available/override.conf \
    && a2enconf override

WORKDIR /var/www/html

# Copy application files
COPY --chown=www-data:www-data . /var/www/html/

EXPOSE 80

CMD ["apache2-foreground"]
